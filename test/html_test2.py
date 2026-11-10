from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw
im=Image.new('RGB',(300,300),(90,140,200)); ImageDraw.Draw(im).ellipse((80,50,220,190),fill=(250,220,190)); im.save('/tmp/face2.jpg')
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':430,'height':900},accept_downloads=True); pg=ctx.new_page()
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
    pg.goto('file:///home/claude/money-flow/dist/family-budget.html'); pg.wait_for_selector('#sfName'); pg.fill('#sfName','บ้านทดสอบ'); pg.click('[data-act=sfdone]'); pg.wait_for_selector('.g3')
    print('nav:', pg.eval_on_selector_all('nav.bn button','e=>e.map(x=>x.innerText.split("\\n").pop())'))
    # income + expense so charts render
    for typ,amt in (('income','45000'),('expense','1200')):
        pg.click('nav .plus'); pg.wait_for_selector('.keys')
        for k in amt: pg.click(f'.keys button[data-k="{k}"]')
        pg.click(f'[data-act=addtype][data-t={typ}]'); pg.click('[data-act=save][data-again="0"]'); pg.wait_for_selector('.g3')
    # category budget
    pg.click('nav button[data-v=cats]'); pg.wait_for_selector('.cat'); pg.click('[data-act=catedit] >> nth=0'); pg.fill('#cfBudget','5000'); pg.click('#cfSave'); pg.wait_for_timeout(300)
    # debt
    pg.click('nav button[data-v=debts]'); pg.wait_for_selector('[data-act=debtadd]'); pg.click('[data-act=debtadd]'); pg.fill('#dfName','ผ่อนมือถือ'); pg.fill('#dfPrin','24000'); pg.fill('#dfInst','2000'); pg.fill('#dfLeft','12'); pg.click('#dfSave'); pg.wait_for_selector('.debt')
    print('debt card:', pg.inner_text('.debt .row.between >> nth=0').replace('\n',' | '))
    pg.click('[data-act=debtcal]'); pg.wait_for_selector('#calIcs')
    with pg.expect_download() as d: pg.click('#calIcs')
    d.value.save_as('/tmp/l.ics'); t=open('/tmp/l.ics').read(); print('ics:', 'RRULE:FREQ=MONTHLY;COUNT=12' in t, 'VALARM' in t)
    pg.wait_for_timeout(3200)
    pg.click('[data-act=debtpay]'); pg.wait_for_selector('#pfSave'); pg.click('#pfSave'); pg.wait_for_timeout(500)
    print('after pay:', pg.inner_text('.debt .row.between.small.muted').replace('\n',' | '), '|', pg.inner_text('.debt .row.between >> nth=2').replace('\n',' '))
    # photo
    pg.click('.gear'); pg.wait_for_selector('.set'); pg.click('[data-act=memedit] >> nth=0'); pg.wait_for_selector('#mfFile',state='attached'); pg.set_input_files('#mfFile','/tmp/face2.jpg'); pg.wait_for_selector('#mfPrev img'); pg.click('#mfSave'); pg.wait_for_timeout(400)
    pg.reload(); pg.wait_for_selector('.g3')
    print('photo persists after reload:', pg.eval_on_selector_all('.avs .av i img','e=>e.length'), '| budget rows:', pg.eval_on_selector_all('.bb','e=>e.length'), '| debtsSoon card:', bool(pg.query_selector('.dsoon')))
    pg.screenshot(path='/tmp/shots2/h_home.png',full_page=True)
    b.close()
print('errors:',errs)
