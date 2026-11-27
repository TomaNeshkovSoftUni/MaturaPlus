/*
 * Миграция 001 – таблица Feedback (FB-14, FB-15, FB-16).
 *
 * Feedback(Id, Type, Message nvarchar(1000), UserId nullable FK,
 *          CreatedAtUtc, Status default 'New', RequestId UNIQUE, ClientKey)
 *
 * ClientKey обвързва RequestId със сесията/потребителя, за да не може
 * чужд клиент да "прочете" запис чрез познат ключ.
 *
 * Users се създава в 002_core.js. FK към Users се добавя там, защото
 * Feedback трябва да работи самостоятелно още от първата миграция.
 */
(function (MP) {
  'use strict';

  MP.feedbackRules = Object.freeze({
    TYPES: Object.freeze(['Problem', 'Suggestion']),
    STATUSES: Object.freeze(['New', 'Reviewed', 'Resolved']),
    MIN_LENGTH: 10,
    MAX_LENGTH: 1000,
  });

  MP.migrations = MP.migrations || [];
  MP.migrations.push({
    version: 1,
    name: '001_feedback',
    up(db) {
      const R = MP.feedbackRules;
      db.createTable('Feedback', {
        columns: {
          Id: { type: 'int', primaryKey: true, autoIncrement: true },
          Type: { type: 'string', enum: R.TYPES },
          Message: { type: 'string', minLength: R.MIN_LENGTH, maxLength: R.MAX_LENGTH },
          UserId: { type: 'int', nullable: true },
          CreatedAtUtc: { type: 'datetime', defaultNow: true },
          Status: { type: 'string', enum: R.STATUSES, default: 'New' },
          RequestId: { type: 'string', unique: true, maxLength: 36 },
          ClientKey: { type: 'string', maxLength: 100 },
        },
      });
    },
  });
})(window.MP = window.MP || {});
