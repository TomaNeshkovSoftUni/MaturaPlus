/*
 * Матура+ | Backend / DB
 * Малък релационен "двигател" върху localStorage (или друго хранилище със
 * същия интерфейс: getItem / setItem / removeItem).
 *
 * Поддържа: таблици със схема, PRIMARY KEY + AUTOINCREMENT, NOT NULL,
 * DEFAULT, CHECK (enum / min / max дължина), UNIQUE, FOREIGN KEY,
 * транзакции (всичко или нищо) и версии на миграциите.
 *
 * Всяка таблица се пази като един JSON ключ: "<prefix>table.<Име>".
 */
(function (MP) {
  'use strict';

  /** Грешка от базата – винаги с код, за да може API слоят да я преведе. */
  class DbError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'DbError';
      this.code = code; // NOT_NULL | CHECK | UNIQUE | FOREIGN_KEY | TYPE | NO_TABLE | STORAGE
      this.details = details || {};
    }
  }

  /** Хранилище в паметта – за тестове (същия интерфейс като localStorage). */
  class MemoryStorage {
    constructor() { this.map = new Map(); this.failWrites = false; }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) {
      if (this.failWrites) throw new Error('Simulated storage failure');
      this.map.set(k, String(v));
    }
    removeItem(k) { this.map.delete(k); }
    keys() { return Array.from(this.map.keys()); }
  }

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  function checkType(col, value) {
    switch (col.type) {
      case 'int': return Number.isInteger(value);
      case 'number': return typeof value === 'number' && Number.isFinite(value);
      case 'string': return typeof value === 'string';
      case 'bool': return typeof value === 'boolean';
      case 'datetime': return typeof value === 'string' && !Number.isNaN(Date.parse(value));
      case 'json': return true;
      default: return false;
    }
  }

  class Database {
    /**
     * @param {{storage?: Storage, prefix?: string}} [options]
     */
    constructor(options) {
      const opts = options || {};
      this.storage = opts.storage || window.localStorage;
      this.prefix = opts.prefix || 'maturaplus.';
      this.schemas = {};   // име → схема
      this.cache = {};     // име → { nextId, rows: [] }
      this.tx = null;      // активна транзакция: { dirty: Set }
      this._loadMeta();
    }

    // ---------- вътрешни помощни ----------
    _key(name) { return this.prefix + name; }

    _read(key) {
      const raw = this.storage.getItem(this._key(key));
      return raw ? JSON.parse(raw) : null;
    }

    _write(key, value) {
      if (this.simulateFailure) throw new DbError('STORAGE', 'Базата е недостъпна (симулация).');
      try {
        this.storage.setItem(this._key(key), JSON.stringify(value));
      } catch (e) {
        throw new DbError('STORAGE', 'Записът в базата е неуспешен.', { cause: e.message });
      }
    }

    _loadMeta() {
      const meta = this._read('__meta') || { version: 0, schemas: {} };
      this.version = meta.version;
      this.schemas = meta.schemas;
    }

    _saveMeta() {
      this._write('__meta', { version: this.version, schemas: this.schemas });
    }

    _data(name) {
      if (!this.schemas[name]) throw new DbError('NO_TABLE', `Таблица ${name} не съществува.`);
      if (!this.cache[name]) {
        this.cache[name] = this._read('table.' + name) || { nextId: 1, rows: [] };
      }
      return this.cache[name];
    }

    _persist(name) {
      if (this.tx) { this.tx.dirty.add(name); return; }
      this._write('table.' + name, this.cache[name]);
    }

    // ---------- схема ----------
    /**
     * Създава таблица. Колоните са описани така:
     * { type, primaryKey, autoIncrement, nullable, default, maxLength, minLength,
     *   defaultNow, enum, unique, references: 'Таблица.Колона', onDelete: 'cascade'|'restrict'|'setNull' }
     * uniques: [['ColA','ColB']] – съставни UNIQUE ограничения.
     */
    createTable(name, definition) {
      if (this.schemas[name]) return;
      this.schemas[name] = { columns: definition.columns, uniques: definition.uniques || [] };
      this.cache[name] = { nextId: 1, rows: [] };
      this._write('table.' + name, this.cache[name]);
      this._saveMeta();
    }

    addColumn(table, column, def) {
      const schema = this.schemas[table];
      schema.columns[column] = def;
      const data = this._data(table);
      data.rows.forEach((r) => {
        if (r[column] === undefined) r[column] = def.defaultNow ? new Date().toISOString() : (def.default ?? null);
      });
      this._persist(table);
      this._saveMeta();
    }

    /** Променя дефиницията на колона (напр. добавя FOREIGN KEY по-късно). */
    alterColumn(table, column, changes) {
      const schema = this.schemas[table];
      if (!schema || !schema.columns[column]) throw new DbError('NO_TABLE', `${table}.${column} не съществува.`);
      schema.columns[column] = Object.assign({}, schema.columns[column], changes);
      this._data(table).rows.forEach((r) => this._validate(table, r, r.Id)); // съществуващите редове трябва да отговарят
      this._saveMeta();
    }

    hasTable(name) { return !!this.schemas[name]; }

    /** Прилага всички миграции с по-голяма версия от текущата, по ред. */
    migrate(migrations) {
      const applied = [];
      migrations
        .slice()
        .sort((a, b) => a.version - b.version)
        .forEach((m) => {
          if (m.version <= this.version) return;
          this.transaction(() => {
            m.up(this);
            this.version = m.version;
            this._saveMeta();
          });
          applied.push(m.name);
        });
      return applied;
    }

    // ---------- ограничения ----------
    _validate(name, row, existingId) {
      const schema = this.schemas[name];
      const cols = schema.columns;

      Object.keys(row).forEach((c) => {
        if (!cols[c]) throw new DbError('TYPE', `Непозната колона ${name}.${c}.`, { column: c });
      });

      Object.entries(cols).forEach(([c, col]) => {
        const v = row[c];
        if (v === null || v === undefined) {
          if (!col.nullable && !col.autoIncrement) {
            throw new DbError('NOT_NULL', `${name}.${c} е задължително.`, { column: c });
          }
          return;
        }
        if (!checkType(col, v)) throw new DbError('TYPE', `${name}.${c} има невалиден тип.`, { column: c });
        if (col.enum && !col.enum.includes(v)) {
          throw new DbError('CHECK', `${name}.${c} има недопустима стойност.`, { column: c });
        }
        if (col.maxLength !== undefined && v.length > col.maxLength) {
          throw new DbError('CHECK', `${name}.${c} е по-дълго от ${col.maxLength}.`, { column: c });
        }
        if (col.minLength !== undefined && v.length < col.minLength) {
          throw new DbError('CHECK', `${name}.${c} е по-кратко от ${col.minLength}.`, { column: c });
        }
        if (col.min !== undefined && v < col.min) throw new DbError('CHECK', `${name}.${c} < ${col.min}.`, { column: c });
        if (col.max !== undefined && v > col.max) throw new DbError('CHECK', `${name}.${c} > ${col.max}.`, { column: c });
        if (col.references) {
          const [refTable, refCol] = col.references.split('.');
          const found = this._data(refTable).rows.some((r) => r[refCol] === v);
          if (!found) throw new DbError('FOREIGN_KEY', `${name}.${c} сочи към несъществуващ ${refTable}.`, { column: c });
        }
      });

      const rows = this._data(name).rows.filter((r) => r.Id !== existingId);
      const uniqueSets = Object.entries(cols).filter(([, col]) => col.unique).map(([c]) => [c]).concat(schema.uniques);
      uniqueSets.forEach((set) => {
        if (set.some((c) => row[c] === null || row[c] === undefined)) return; // NULL не участва в UNIQUE
        const clash = rows.some((r) => set.every((c) => r[c] === row[c]));
        if (clash) throw new DbError('UNIQUE', `Нарушено UNIQUE ограничение (${name}: ${set.join(', ')}).`, { columns: set });
      });
    }

    // ---------- CRUD ----------
    insert(name, values) {
      const schema = this.schemas[name];
      if (!schema) throw new DbError('NO_TABLE', `Таблица ${name} не съществува.`);
      const data = this._data(name);
      const row = {};
      Object.entries(schema.columns).forEach(([c, col]) => {
        let v = values[c];
        if (v === undefined) v = col.defaultNow ? new Date().toISOString() : col.default;
        row[c] = v === undefined ? null : v;
      });
      Object.keys(values).forEach((c) => { if (!(c in row)) row[c] = values[c]; });
      if (schema.columns.Id && schema.columns.Id.autoIncrement) row.Id = data.nextId;

      this._validate(name, row, null);
      data.rows.push(row);
      if (schema.columns.Id && schema.columns.Id.autoIncrement) data.nextId += 1;
      this._persist(name);
      return clone(row);
    }

    update(name, id, patch) {
      const data = this._data(name);
      const idx = data.rows.findIndex((r) => r.Id === id);
      if (idx === -1) return null;
      const next = Object.assign({}, data.rows[idx], patch, { Id: id });
      this._validate(name, next, id);
      data.rows[idx] = next;
      this._persist(name);
      return clone(next);
    }

    /** Изтрива ред, като спазва onDelete правилата на зависимите таблици. */
    remove(name, id) {
      const data = this._data(name);
      const idx = data.rows.findIndex((r) => r.Id === id);
      if (idx === -1) return false;
      Object.entries(this.schemas).forEach(([other, schema]) => {
        Object.entries(schema.columns).forEach(([c, col]) => {
          if (col.references !== name + '.Id') return;
          const dependants = this._data(other).rows.filter((r) => r[c] === id);
          if (!dependants.length) return;
          if (col.onDelete === 'cascade') dependants.forEach((d) => this.remove(other, d.Id));
          else if (col.onDelete === 'setNull') dependants.forEach((d) => this.update(other, d.Id, { [c]: null }));
          else throw new DbError('FOREIGN_KEY', `Записът се използва в ${other}.`, { table: other });
        });
      });
      data.rows.splice(data.rows.findIndex((r) => r.Id === id), 1);
      this._persist(name);
      return true;
    }

    findById(name, id) { return clone(this._data(name).rows.find((r) => r.Id === id)) || null; }

    findOne(name, predicate) { return clone(this._data(name).rows.find(predicate)) || null; }

    /**
     * Заявка с филтър, сортиране и страниране.
     * @returns {{items: object[], total: number}}
     */
    query(name, opts) {
      const o = opts || {};
      let rows = this._data(name).rows;
      if (o.where) rows = rows.filter(o.where);
      const total = rows.length;
      if (o.orderBy) {
        const [col, dir] = o.orderBy;
        const mul = dir === 'desc' ? -1 : 1;
        rows = rows.slice().sort((a, b) => (a[col] > b[col] ? mul : a[col] < b[col] ? -mul : 0));
      }
      if (o.skip) rows = rows.slice(o.skip);
      if (o.take !== undefined) rows = rows.slice(0, o.take);
      return { items: clone(rows), total };
    }

    all(name, where) { return this.query(name, { where }).items; }

    count(name, where) { return this.query(name, { where, take: 0 }).total; }

    /**
     * Транзакция: ако fn хвърли грешка, нищо от нея не остава в базата.
     * Записът в хранилището става едва при успешен край (commit).
     */
    transaction(fn) {
      if (this.tx) return fn(this); // вложена – част от външната
      const snapshot = { cache: clone(this.cache), schemas: clone(this.schemas), version: this.version };
      this.tx = { dirty: new Set() };
      try {
        const result = fn(this);
        const dirty = Array.from(this.tx.dirty);
        this.tx = null;
        dirty.forEach((n) => this._write('table.' + n, this.cache[n]));
        return result;
      } catch (e) {
        this.tx = null;
        this.cache = snapshot.cache;
        this.schemas = snapshot.schemas;
        this.version = snapshot.version;
        // хранилището може вече да е частично записано – възстановяваме го
        try {
          Object.keys(this.cache).forEach((n) => this._write('table.' + n, this.cache[n]));
          this._saveMeta();
        } catch (ignored) { /* хранилището е недостъпно – кешът е върнат */ }
        throw e;
      }
    }

    /** Изтрива всички таблици с този префикс (само за демо/тестове). */
    reset() {
      Object.keys(this.schemas).forEach((n) => this.storage.removeItem(this._key('table.' + n)));
      this.storage.removeItem(this._key('__meta'));
      this.cache = {};
      this.schemas = {};
      this.version = 0;
    }
  }

  MP.db = MP.db || {};
  MP.db.Database = Database;
  MP.db.DbError = DbError;
  MP.db.MemoryStorage = MemoryStorage;
})(window.MP = window.MP || {});
