/* DB тестове за Feedback (FB-14 … FB-17) – член 3 */
(function (MP) {
  'use strict';
  const { describe, it, expect } = MP.test;
  const { Database, MemoryStorage } = MP.db;

  const fbOnly = MP.migrations.filter((m) => m.name === '001_feedback');
  const newDb = (storage) => { const db = new Database({ storage: storage || new MemoryStorage(), prefix: 't.' }); db.migrate(fbOnly); return db; };
  const row = (extra) => Object.assign({ Type: 'Problem', Message: 'Текст с поне десет символа', RequestId: MP.uuid(), ClientKey: 'guest:x' }, extra || {});

  describe('DB: таблица Feedback', () => {
    it('миграцията създава таблицата и записва версията', () => {
      const db = newDb();
      expect(db.hasTable('Feedback')).toBe(true);
      expect(db.version).toBe(1);
    });

    it('миграцията не се прилага втори път', () => {
      const storage = new MemoryStorage();
      newDb(storage);
      const db2 = new Database({ storage, prefix: 't.' });
      expect(db2.migrate(fbOnly)).toEqual([]);
    });

    it('стойности по подразбиране: Id, Status = New, CreatedAtUtc, UserId = null', () => {
      const r = newDb().insert('Feedback', row());
      expect(r.Id).toBe(1);
      expect(r.Status).toBe('New');
      expect(r.UserId).toBe(null);
      expect(Number.isNaN(Date.parse(r.CreatedAtUtc))).toBe(false);
    });

    it('CHECK: невалиден тип се отхвърля', async () => {
      const db = newDb();
      await expect(() => db.insert('Feedback', row({ Type: 'Bug' }))).toThrowCode('CHECK');
    });

    it('CHECK: невалиден статус се отхвърля', async () => {
      const db = newDb();
      const r = db.insert('Feedback', row());
      await expect(() => db.update('Feedback', r.Id, { Status: 'Deleted' })).toThrowCode('CHECK');
    });

    it('CHECK: дължина 9 и 1001 се отхвърлят, 10 и 1000 се приемат', async () => {
      const db = newDb();
      await expect(() => db.insert('Feedback', row({ Message: 'а'.repeat(9) }))).toThrowCode('CHECK');
      await expect(() => db.insert('Feedback', row({ Message: 'а'.repeat(1001) }))).toThrowCode('CHECK');
      expect(db.insert('Feedback', row({ Message: 'а'.repeat(10) })).Message.length).toBe(10);
      expect(db.insert('Feedback', row({ Message: 'а'.repeat(1000) })).Message.length).toBe(1000);
    });

    it('NOT NULL: липсващ тип или текст се отхвърлят', async () => {
      const db = newDb();
      await expect(() => db.insert('Feedback', row({ Type: null }))).toThrowCode('NOT_NULL');
      await expect(() => db.insert('Feedback', row({ Message: undefined }))).toThrowCode('NOT_NULL');
    });

    it('UNIQUE RequestId: дублиран ключ НЕ създава втори запис', async () => {
      const db = newDb();
      const id = MP.uuid();
      db.insert('Feedback', row({ RequestId: id }));
      await expect(() => db.insert('Feedback', row({ RequestId: id }))).toThrowCode('UNIQUE');
      expect(db.count('Feedback')).toBe(1);
    });

    it('транзакция: при грешка нищо не се записва', () => {
      const db = newDb();
      try {
        db.transaction(() => {
          db.insert('Feedback', row());
          db.insert('Feedback', row({ Type: 'Невалиден' }));
        });
      } catch (e) { /* очаквано */ }
      expect(db.count('Feedback')).toBe(0);
    });

    it('persistence: записът остава след "рестарт" (нова инстанция върху същото хранилище)', () => {
      const storage = new MemoryStorage();
      newDb(storage).insert('Feedback', row({ Message: 'Ще остане след рестарт' }));
      const restarted = new Database({ storage, prefix: 't.' });
      expect(restarted.count('Feedback')).toBe(1);
      expect(restarted.findById('Feedback', 1).Message).toBe('Ще остане след рестарт');
      expect(restarted.insert('Feedback', row()).Id).toBe(2); // autoincrement продължава
    });

    it('persistence в истинския localStorage (отделен префикс)', () => {
      const prefix = 'maturaplus.selftest.';
      const a = new Database({ storage: window.localStorage, prefix });
      a.reset();
      a.migrate(fbOnly);
      a.insert('Feedback', row());
      const b = new Database({ storage: window.localStorage, prefix });
      expect(b.count('Feedback')).toBe(1);
      b.reset();
    });

    it('отказ на хранилището → DbError STORAGE и няма частичен запис', async () => {
      const storage = new MemoryStorage();
      const db = newDb(storage);
      storage.failWrites = true;
      await expect(() => db.transaction(() => db.insert('Feedback', row()))).toThrowCode('STORAGE');
      storage.failWrites = false;
      expect(db.count('Feedback')).toBe(0);
    });

  });
})(window.MP = window.MP || {});
