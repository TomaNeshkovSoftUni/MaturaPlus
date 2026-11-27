/*
 * Клиентска валидация на обратната връзка (FB-04).
 * Същите правила като на сървъра: след trim() текстът е 10–1000 символа
 * (броене чрез String.length). Сървърът валидира отново – тук е за UX.
 */
(function (MP) {
  'use strict';

  const RULES = Object.freeze({ TYPES: ['Problem', 'Suggestion'], MIN: 10, MAX: 1000 });

  /**
   * @param {{type: string|null, message: string}} values
   * @returns {Object<string,string>} грешки по полета (празен обект = валидно)
   */
  function validateFeedback(values) {
    const errors = {};
    const type = values && values.type;
    const message = values && typeof values.message === 'string' ? values.message.trim() : '';

    if (!type) errors.type = 'Изберете тип: „Проблем“ или „Предложение“.';
    else if (!RULES.TYPES.includes(type)) errors.type = 'Невалиден тип обратна връзка.';

    if (message.length === 0) errors.message = 'Въведете текст на обратната връзка.';
    else if (message.length < RULES.MIN) errors.message = `Текстът трябва да е поне ${RULES.MIN} символа (сега: ${message.length}).`;
    else if (message.length > RULES.MAX) errors.message = `Текстът трябва да е най-много ${RULES.MAX} символа (сега: ${message.length}).`;

    return errors;
  }

  /** Текст и състояние на брояча под полето. */
  function counterState(rawMessage) {
    const n = String(rawMessage || '').trim().length;
    let level = 'ok';
    if (n > RULES.MAX) level = 'error';
    else if (n > RULES.MAX - 100) level = 'warn';
    return { count: n, text: `${n} / ${RULES.MAX}`, level };
  }

  MP.feedback = MP.feedback || {};
  MP.feedback.RULES = RULES;
  MP.feedback.validate = validateFeedback;
  MP.feedback.counterState = counterState;
})(window.MP = window.MP || {});
