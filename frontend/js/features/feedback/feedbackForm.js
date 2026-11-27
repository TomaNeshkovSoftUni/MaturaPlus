/*
 * Логика на формата за обратна връзка (FB-04, FB-05, FB-06, FB-20).
 *
 * - синхронен guard (като useRef) + isSubmitting ПРЕДИ заявката
 * - бутонът е disabled; Enter и двоен клик не изпращат втори път
 * - try / catch / finally: бутонът се възстановява при всеки изход
 * - успех → съобщение + изчистване; грешка → текстът остава
 * - requestId се пази при повторен опит със същите данни;
 *   нов ключ при редакция или ново изпращане
 */
(function (MP) {
  'use strict';

  const MSG_SUCCESS = 'Обратната връзка е изпратена успешно.';
  const MSG_FAIL = 'Неуспешно изпращане. Опитайте отново.';

  /**
   * @param {HTMLFormElement} form
   * @param {{api?: object, uuid?: Function}} [deps] – подменят се в тестовете
   */
  function initFeedbackForm(form, deps) {
    const d = deps || {};
    const api = d.api || MP.apiClient;
    const uuid = d.uuid || MP.uuid;
    const ui = MP.ui;

    const els = {
      message: form.elements.message,
      button: form.querySelector('[type="submit"]'),
      buttonLabel: form.querySelector('[data-role="submit-label"]'),
      spinner: form.querySelector('[data-role="spinner"]'),
      status: form.querySelector('[data-role="status"]'),
      counter: form.querySelector('[data-role="counter"]'),
    };

    const submittingRef = { current: false }; // синхронен guard
    const state = { isSubmitting: false, pending: null, attempted: false };

    const values = () => {
      const checked = form.querySelector('input[name="type"]:checked');
      return { type: checked ? checked.value : null, message: els.message.value };
    };

    function setStatus(type, text) {
      // aria-live регионът остава в DOM – сменяме само съдържанието
      els.status.className = text ? `alert alert--${type}` : 'alert';
      els.status.textContent = text || '';
    }

    function setSubmitting(on) {
      state.isSubmitting = on;
      els.button.disabled = on;
      els.button.setAttribute('aria-busy', String(on));
      els.buttonLabel.textContent = on ? 'Изпращане...' : 'Изпрати';
      if (els.spinner) els.spinner.hidden = !on;
    }

    function updateCounter() {
      const c = MP.feedback.counterState(els.message.value);
      els.counter.textContent = c.text;
      els.counter.className = 'counter' + (c.level === 'ok' ? '' : ` counter--${c.level}`);
    }

    function revalidate() {
      if (!state.attempted) return;
      ui.showFieldErrors(form, MP.feedback.validate(values()));
    }

    async function submit() {
      if (submittingRef.current) return 'blocked'; // втори submit докато първият тече
      state.attempted = true;
      const v = values();
      const errors = MP.feedback.validate(v);
      const first = ui.showFieldErrors(form, errors);
      if (Object.keys(errors).length) {
        setStatus('error', 'Моля, поправете отбелязаните полета.');
        if (first) first.focus();
        return 'invalid';
      }

      submittingRef.current = true; // веднага, синхронно – преди await
      setSubmitting(true);
      setStatus('info', 'Изпращане...');

      const payload = { type: v.type, message: v.message.trim() };
      // същият payload → същият ключ (безопасен retry); иначе нов
      const same = state.pending && state.pending.type === payload.type && state.pending.message === payload.message;
      const requestId = same ? state.pending.requestId : uuid();
      state.pending = { requestId, type: payload.type, message: payload.message };

      try {
        const res = await api.post('/api/feedback', { type: payload.type, message: payload.message, requestId });
        if (res.status === 201) {
          state.pending = null;
          state.attempted = false;
          form.reset();
          ui.showFieldErrors(form, {});
          updateCounter();
          setStatus('success', MSG_SUCCESS);
          return 'success';
        }
        if (res.status === 400 && res.data && res.data.errors) ui.showFieldErrors(form, res.data.errors);
        if (res.status === 409) state.pending = null; // ключът е "изгорял" – следващият опит е с нов
        const detail = res.status === 429 || res.status === 409 ? ' ' + ui.errorText(res) : '';
        setStatus('error', MSG_FAIL + detail);
        return 'error:' + res.status;
      } catch (e) {
        // timeout или мрежова грешка – пазим ключа, за да е безопасен retry
        setStatus('error', MSG_FAIL);
        return 'error:network';
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    els.message.addEventListener('input', () => { updateCounter(); revalidate(); });
    form.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener('change', revalidate));
    updateCounter();

    return { submit, state, submittingRef };
  }

  MP.feedback = MP.feedback || {};
  MP.feedback.initForm = initFeedbackForm;
  MP.feedback.MESSAGES = { SUCCESS: MSG_SUCCESS, FAIL: MSG_FAIL };
})(window.MP = window.MP || {});
