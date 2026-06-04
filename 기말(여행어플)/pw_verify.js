const { chromium } = require('/Users/heyyyang/.npm/_npx/5e2e484947874241/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/01_home.png' });
  const body1 = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log('HOME:', body1);

  // Click first trip
  const clicked = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[style]'));
    for (const el of els) {
      if (el.style && el.style.cursor === 'pointer' && el.innerText) {
        const t = el.innerText.trim();
        if (t && t.length < 60 && t.length > 0) { el.click(); return t; }
      }
    }
    return null;
  });
  console.log('Clicked trip:', clicked);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/02_planner.png' });

  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => b.textContent && b.textContent.trim()).filter(Boolean)
  );
  console.log('BUTTONS:', JSON.stringify(buttons.slice(0, 25)));

  // Find 경비 tab
  const expBtns = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.filter(b => b.textContent && b.textContent.includes('경비')).map(b => b.textContent.trim());
  });
  console.log('경비 buttons found:', expBtns);

  if (expBtns.length > 0) {
    await page.click('button:text("💰 경비")').catch(() => page.click('button:text("경비")'));
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/03_expenses.png' });
    const body3 = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.log('EXPENSES TAB:', body3);
  } else {
    console.log('경비 NOT in button list');
    const html = await page.evaluate(() => {
      const d = Array.from(document.querySelectorAll('div')).find(d => d.textContent && d.textContent.includes('여행 계획') && d.textContent.includes('체크'));
      return d ? d.innerHTML.slice(0, 800) : 'not found';
    });
    console.log('TAB BAR HTML:', html);
  }

  await browser.close();
})();
