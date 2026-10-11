(() => {
  const input = document.getElementById('customStakeInput');
  const payout = document.getElementById('payoutDisplay');
  const chips = [...document.querySelectorAll('.stake-chip')];
  const money = value => '$' + value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const notify = message => {
    const element = document.getElementById('notification');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => element.classList.remove('visible'), 5000);
  };
  let multiplier = 1.92;
  function updateStake() {
    const amount = Math.max(0, Math.min(14250, Number(input.value) || 0));
    payout.textContent = money(amount * multiplier);
    payout.nextElementSibling.textContent = '+' + money(amount * (multiplier - 1)) + ' NET PROFIT';
    chips.forEach(chip => {
      const selected = Number(chip.dataset.stake) === amount;
      chip.classList.toggle('selected', selected);
      chip.setAttribute('aria-pressed', String(selected));
    });
  }
  chips.forEach(chip => chip.addEventListener('click', () => { input.value = chip.dataset.stake; updateStake(); }));
  input.addEventListener('input', updateStake);
  input.addEventListener('change', () => { input.value = Math.max(1, Math.min(14250, Number(input.value) || 1)); updateStake(); });
  document.querySelectorAll('button').forEach(button => {
    if (button.dataset.direction) button.addEventListener('click', () => {
      if (!input.checkValidity() || !Number(input.value)) { input.reportValidity(); return; }
      const direction = button.dataset.direction;
      multiplier = Number(button.dataset.multiplier);
      document.getElementById('returnMultiplier').textContent = `${multiplier.toFixed(2)}x ${direction}`;
      updateStake();
      document.querySelectorAll('[data-direction]').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
      notify(`Demo ${direction} prediction placed · ${money(Number(input.value))} USDC · No funds transferred`);
    });
    if (button.textContent.includes('DEPOSIT')) button.addEventListener('click', () => notify('Demo vault · $14,250.00 USDC available for simulated predictions'));
  });
  document.querySelectorAll('nav a').forEach((link, index) => {
    const destinations = ['main', '#tier-filter-bar', '#customStakeInput', 'table'];
    link.addEventListener('click', event => { event.preventDefault(); document.querySelector(destinations[index]).scrollIntoView({behavior: 'smooth', block: 'center'}); });
  });
  updateStake();
})();
