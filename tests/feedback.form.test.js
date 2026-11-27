/* Frontend тестове на формата (FB-03 … FB-06, FB-20, FB-22) – членове 1 и 2.
 * Формата се създава от <template id="feedback-template"> в tests/index.html
 * (копие на формата от feedback.html). */
(function (MP) {
  'use strict';
  const { describe, it, expect, sleep, freshBackend } = MP.test;

  /** Ръчно управляем фалшив API: всяка заявка чака resolve/reject отвън. */
  function fakeApi() {
    const calls = [];
    return {
      calls,
      post(path, payload) {
        return new Promise((resolve, reject) => calls.push({ path, payload, resolve, reject }));
      },
      last() { return calls[calls.length - 1]; },
    };
  }

  function mount(api, uuid) {
    const host = document.getElementById('sandbox');
    host.innerHTML = '';
    host.appendChild(document.getElementById('feedback-template').content.cloneNode(true));
    const form = host.querySelector('form');
    let n = 0;
    const ctl = MP.feedback.initForm(form, { api, uuid: uuid || (() => 'id-' + (n += 1)) });
    const $ = (s) => form.querySelector(s);
    return {
      form, ctl,
      fill(type, text) {
        if (type) $(`input[value="${type}"]`).checked = true;
        form.elements.message.value = text;
        form.elements.message.dispatchEvent(new Event('input'));
      },
      submit() { form.requestSubmit(); },
      button: $('[type="submit"]'),
      status: () => $('[data-role="status"]').textContent,
      fieldError: (name) => $(`[data-error-for="${name}"]`).textContent,
      counter: () => $('[data-role="counter"]').textContent,
    };
  }
  const flush = () => sleep(0);
  const ok201 = { ok: true, status: 201, data: { id: 1, status: 'New' }, headers: {} };

  describe('Форма: клиентска валидация', () => {
    it('валидацията приема 10 и 1000 и отхвърля 9 и 1001 символа след trim', () => {
      const v = (n) => MP.feedback.validate({ type: 'Problem', message: '  ' + 'б'.repeat(n) + ' ' });
      expect(v(9)).toHaveKey('message');
      expect(v(10)).toEqual({});
      expect(v(1000)).toEqual({});
      expect(v(1001)).toHaveKey('message');
    });

    it('липсващ тип и невалиден тип се отхвърлят', () => {
      expect(MP.feedback.validate({ type: null, message: 'Достатъчно дълъг текст' })).toHaveKey('type');
      expect(MP.feedback.validate({ type: 'Other', message: 'Достатъчно дълъг текст' })).toHaveKey('type');
    });

    it('празно и само интервали → грешка, заявка НЕ се изпраща', async () => {
      const api = fakeApi();
      const f = mount(api);
      f.fill('Problem', '     ');
      f.submit();
      await flush();
      expect(api.calls.length).toBe(0);
      expect(f.fieldError('message')).toContain('Въведете текст');
    });

    it('грешките са на български до полетата и с aria-invalid', async () => {
      const f = mount(fakeApi());
      f.fill(null, 'кратко');
      f.submit();
      await flush();
      expect(f.fieldError('type')).toContain('Изберете тип');
      expect(f.fieldError('message')).toContain('поне 10');
      expect(f.form.elements.message.getAttribute('aria-invalid')).toBe('true');
    });

    it('броячът показва символите след trim', () => {
      const f = mount(fakeApi());
      f.fill('Problem', '  абв  ');
      expect(f.counter()).toBe('3 / 1000');
    });

    it('textarea няма maxlength – текстът не се реже тихомълком', () => {
      const f = mount(fakeApi());
      expect(f.form.elements.message.hasAttribute('maxlength')).toBe(false);
    });

    it('статусът е в aria-live регион', () => {
      const f = mount(fakeApi());
      expect(f.form.querySelector('[data-role="status"]').getAttribute('aria-live')).toBe('polite');
    });
  });

  describe('Форма: изпращане, guard и съобщения', () => {
    it('бавен отговор: бутонът е disabled с „Изпращане...“; двоен клик и Enter не изпращат втори път', async () => {
      const api = fakeApi();
      const f = mount(api);
      f.fill('Suggestion', 'Нека има и мобилно приложение.');
      f.submit();
      f.button.click();  // двоен клик
      f.submit();        // Enter = implicit submit
      await flush();
      expect(api.calls.length).toBe(1);
      expect(f.button.disabled).toBe(true);
      expect(f.button.textContent.trim()).toBe('Изпращане...');
      expect(f.ctl.submittingRef.current).toBe(true);
      api.last().resolve(ok201);
      await flush();
      expect(f.button.disabled).toBe(false);
    });

    it('успех: съобщение, изчистена форма, бутонът е възстановен; trim-нат текст в payload', async () => {
      const api = fakeApi();
      const f = mount(api);
      f.fill('Problem', '   Тестът не се зарежда.   ');
      f.submit();
      await flush();
      expect(api.last().payload.message).toBe('Тестът не се зарежда.');
      expect(f.status()).toBe('Изпращане...'); // няма успех преди отговор от сървъра
      api.last().resolve(ok201);
      await flush();
      expect(f.status()).toBe(MP.feedback.MESSAGES.SUCCESS);
      expect(f.form.elements.message.value).toBe('');
      expect(f.form.querySelector('input[name="type"]:checked')).toBe(null);
      expect(f.button.textContent.trim()).toBe('Изпрати');
    });

    [[400, { error: 'Невалидни данни.', errors: { message: 'Текстът трябва да е поне 10 символа.' } }], [429, { error: 'Твърде много заявки.' }], [500, { error: MP.api && MP.api.SAFE_500 }]].forEach(([status, data]) => {
      it(`HTTP ${status}: грешка, текстът остава, бутонът се възстановява`, async () => {
        const api = fakeApi();
        const f = mount(api);
        f.fill('Problem', 'Текст, който трябва да остане.');
        f.submit();
        await flush();
        api.last().resolve({ ok: false, status, data, headers: {} });
        await flush();
        expect(f.status()).toContain(MP.feedback.MESSAGES.FAIL);
        expect(f.form.elements.message.value).toBe('Текст, който трябва да остане.');
        expect(f.button.disabled).toBe(false);
      });
    });

    it('мрежова грешка: съобщение, текстът остава; retry със СЪЩИЯ requestId', async () => {
      const api = fakeApi();
      const f = mount(api);
      f.fill('Problem', 'Нещо не работи при изпращане.');
      f.submit();
      await flush();
      api.last().reject(new MP.NetworkError('offline'));
      await flush();
      expect(f.status()).toBe(MP.feedback.MESSAGES.FAIL);
      expect(f.button.disabled).toBe(false);
      const firstId = api.last().payload.requestId;
      f.submit();
      await flush();
      expect(api.last().payload.requestId).toBe(firstId);
    });

    it('редакция след грешка → НОВ requestId', async () => {
      const api = fakeApi();
      const f = mount(api);
      f.fill('Problem', 'Първоначален текст на грешката.');
      f.submit();
      await flush();
      api.last().reject(new MP.NetworkError('timeout'));
      await flush();
      const firstId = api.last().payload.requestId;
      f.fill(null, 'Редактиран текст на грешката.');
      f.submit();
      await flush();
      expect(api.last().payload.requestId === firstId).toBe(false);
    });

    it('след успех следващото изпращане е с нов requestId', async () => {
      const api = fakeApi();
      const f = mount(api);
      f.fill('Problem', 'Един и същ текст за проверка.');
      f.submit(); await flush();
      const id1 = api.last().payload.requestId;
      api.last().resolve(ok201); await flush();
      f.fill('Problem', 'Един и същ текст за проверка.');
      f.submit(); await flush();
      expect(api.last().payload.requestId === id1).toBe(false);
    });
  });

  describe('API клиент: timeout и мрежа', () => {
    it('timeout → NetworkError(kind=timeout)', async () => {
      const client = MP.createApiClient({ transport: () => new Promise(() => {}), timeoutMs: 50, latencyMs: 0, clientId: 't', getSession: () => null });
      try { await client.post('/api/feedback', {}); throw new Error('няма timeout'); } catch (e) { expect(e.kind).toBe('timeout'); }
    });

    it('end-to-end: форма → API клиент → сървър → DB (истинска заявка)', async () => {
      const b = freshBackend({ seed: false });
      const client = MP.createApiClient({ transport: (req) => b.server.handle(req), latencyMs: 0, clientId: 'e2e', getSession: () => null });
      const f = mount(client, MP.uuid);
      f.fill('Suggestion', 'Добавете още пробни матури.');
      f.submit();
      await sleep(20);
      expect(f.status()).toBe(MP.feedback.MESSAGES.SUCCESS);
      expect(b.db.all('Feedback')[0].Message).toBe('Добавете още пробни матури.');
    });
  });
})(window.MP = window.MP || {});
