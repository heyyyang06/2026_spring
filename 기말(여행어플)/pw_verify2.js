const { chromium } = require('/Users/heyyyang/.npm/_npx/5e2e484947874241/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // Open any trip (click first clickable)
  await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[style]'));
    for (const el of els) {
      if (el.style && el.style.cursor === 'pointer') { el.click(); return; }
    }
  });
  await page.waitForTimeout(1500);

  // Open 경비 tab
  await page.click('button:text("💰 경비")');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/03_expenses_empty.png', fullPage: false });

  // Click the FAB (+)
  const fab = await page.;
  if (fab) {
    await fab.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/04_expense_sheet.png' });
    const sheetText = await page.evaluate(() => document.body.innerText.slice(400, 900));
    console.log('BOTTOM SHEET:', sheetText);

    // Fill in amount
    const amountInput = await page.;
    if (amountInput) {
      await amountInput.fill('24.50');
      console.log('Filled amount: 24.50');
    }

    // Check currency field has value
    const curInput = await page.;
    const curVal = curInput ? await curInput.evaluate(el => el.value) : 'not found';
    console.log('Currency value:', curVal);

    // Click 식비 category
    const catBtns = await page.49394('button');
    for (const btn of catBtns) {
      const txt = await btn.evaluate(el => el.innerText);
      if (txt && txt.includes('식비')) { await btn.click(); console.log('Clicked 식비'); break; }
    }

    await page.screenshot({ path: '/tmp/05_expense_filled.png' });

    // Click 저장하기
    const saveBtns = await page.49394('button');
    for (const btn of saveBtns) {
      const txt = await btn.evaluate(el => el.innerText);
      if (txt && txt.includes('저장하기')) { await btn.click(); console.log('Clicked 저장'); break; }
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/06_after_save.png' });
    const afterSave = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.log('AFTER SAVE:', afterSave);
  } else {
    console.log('FAB not found');
    const bodyFull = await page.evaluate(() => document.body.innerText);
    console.log('FULL BODY:', bodyFull.slice(0, 500));
  }

  // Test sub-view tabs
  for (const label of ['카테고리', '인물', '통화', '정산']) {
    await page.click('button:text("' + label + '")').catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: '/tmp/07_settle_view.png' });
  const settleText = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log('SETTLE VIEW:', settleText);

  await browser.close();
  console.log('DONE - screenshots at /tmp/03 through /tmp/07');
})();
