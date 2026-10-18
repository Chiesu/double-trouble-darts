"""V4 integration tests. Requires Python Playwright + Chromium; Xvfb on headless Linux.
Runs the shipped HTML/CSS/JS, actual WebGL, mouse events, and an in-memory native bridge.
Never reads or modifies a user's club.json. See TEST-REPORT.md for scope/limitations.
"""
from pathlib import Path
from copy import deepcopy
import json, math, os, shutil, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'Web'
OUTPUT = ROOT / 'Tests' / 'Output'
OUTPUT.mkdir(exist_ok=True)
SECTORS = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5]
ERRORS=[]
RESULTS=[]

def document(seed=None, fallback=False):
    text=(WEB/'index.html').read_text()
    for name in ('styles.css','v4.css','soft-sport.css'):
        text=text.replace(f'<link rel="stylesheet" href="./{name}">', '<style>'+ (WEB/name).read_text()+'</style>')
    for name in ('engine/dart-stage.js','app.js'):
        text=text.replace(f'<script src="./{name}" defer></script>','')
    bridge="""window.__writes=[];window.__exports=[];
window.webkit={messageHandlers:{dartsSave:{postMessage(s){window.__DOUBLE_TROUBLE_SAVED_JSON__=s;window.__writes.push(s);}},dartsExport:{postMessage(s){window.__exports.push(s);}}}};"""
    if seed is not None:
        bridge += 'window.__DOUBLE_TROUBLE_SAVED_JSON__='+json.dumps(json.dumps(seed))+';'
    if fallback:
        bridge += "const originalContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...args){return t==='webgl2'?null:originalContext.call(this,t,...args);};"
    scripts = '<script>'+bridge+'</script>' + ''.join('<script>'+(WEB/name).read_text()+'</script>' for name in ('engine/dart-stage.js','app.js'))
    return text.replace('</body>', scripts+'</body>')

def new_page(browser, seed=None, width=1440, height=900, real=False, fallback=False):
    page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
    page.set_default_timeout(10000)
    page.emulate_media(reduced_motion='no-preference' if real else 'reduce')
    page.on('dialog',lambda d:d.accept())
    page.on('pageerror', lambda e: ERRORS.append(str(e)))
    page.set_content(document(seed,fallback),wait_until='load')
    page.wait_for_function('() => !!window.DoubleTrouble')
    if state(page).get('screen')=='match':
        page.wait_for_function('() => DoubleTrouble.sceneInfo() !== null')
    return page

def state(p):return p.evaluate('DoubleTrouble.getState()')
def match(p):return state(p)['match']
def scene(p):return p.evaluate('DoubleTrouble.sceneInfo()')
def start(p, mode='501'):
    p.locator(f'[data-action=mode][data-value="{mode}"]').click()
    p.locator('[data-action=start]').click()
    p.wait_for_function('() => DoubleTrouble.isInputReady()')
def wait_shot(p):
    p.wait_for_function('() => DoubleTrouble.sceneInfo().darts.every(d=>!d.flying)')
    p.wait_for_function("() => DoubleTrouble.isInputReady() || !document.querySelector('[data-action=end-turn]').disabled || DoubleTrouble.getState().match.status==='finished'")
def throw(p, x=0, y=-112, wait=True):
    xy=p.evaluate('([x,y])=>DoubleTrouble.boardPoint(x,y)',[x,y])
    assert xy and 0<=xy['x']<=p.viewport_size['width'] and 0<=xy['y']<=p.viewport_size['height'],xy
    p.mouse.click(xy['x'],xy['y'])
    if wait:wait_shot(p)
def target(n, r=112):
    a=math.radians(-90+18*SECTORS.index(n))
    return math.cos(a)*r,math.sin(a)*r

def handoff(p):
    p.locator('[data-action=end-turn]').click()
    p.wait_for_function('() => DoubleTrouble.isInputReady()')
def miss_turn(p):
    for _ in range(3):throw(p,270,0)
    handoff(p)
def restore(p,browser,real=False):
    s=state(p);p.close();return new_page(browser,s,real=real)
def check(name):
    RESULTS.append(name);print('PASS',name,flush=True)
def blank_match(browser, game='501'):
    p=new_page(browser);start(p,game);s=state(p);p.close();return s

def main():
    xvfb=None
    if sys.platform.startswith('linux'):
        xvfb=subprocess.Popen(['Xvfb',':97','-screen','0','1600x1000x24','-nolisten','tcp'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        os.environ['DISPLAY']=':97';time.sleep(.5)
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or None,
                headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-networking'])
            p=new_page(browser)
            # Same V3 board-space scoring for all 20 sectors and five rings.
            for n in SECTORS:
                for r,mult in [(60,1),(112,3),(150,1),(185,2),(195,0)]:
                    hit=p.evaluate('([x,y])=>DoubleTrouble.dartAt(x,y)',target(n,r))
                    assert hit['score']==n*mult and (hit['multiplier']==mult if mult else hit['kind']=='miss'),(n,r,hit)
            for x,y,score in [(0,0,50),(12,0,25),(7.5,0,50),(18,0,25),(192,0,12),(192.001,0,0),(270,-80,0)]:
                hit=p.evaluate('([x,y])=>DoubleTrouble.dartAt(x,y)',[x,y]);assert hit['score']==score,(x,hit)
            assert p.evaluate('DoubleTrouble.dartAt(NaN,0)') is None
            assert p.evaluate('DoubleTrouble.dartAt(Infinity,0)') is None
            check('107 canonical board/ring/bull/miss classifications + invalid coordinates')
            # Saved profiles, upload, unique default colors, custom flight color.
            p.locator('[data-player-name]').nth(0).fill('Andrea');p.locator('[data-player-name]').nth(1).fill('Sam')
            p.locator('[data-dart-color]').nth(0).fill('#ff703e')
            p.locator('[data-dart-color]').nth(0).dispatch_event('change')
            first=state(p)['profiles'][0]
            assert first['name']=='Andrea' and first['dartColor']=='#ff703e'
            assert first['dartColor']!=state(p)['profiles'][1]['dartColor']
            p.screenshot(path=str(OUTPUT/'V4-Setup.png'))
            start(p);assert scene(p)['mode']=='3d',scene(p)
            p.evaluate('window.__originalCanvas=document.querySelector(".dart-canvas")')
            assert p.locator('[data-action=end-turn]').is_disabled()
            assert p.locator('[data-action=miss]').count()==0
            throw(p,0,-112);throw(p,270,0);throw(p,0,0)
            m=match(p);assert m['activeIndex']==0 and m['turnPhase']=='handoff' and m['players'][0]['score']==391,m
            assert [s['score'] for s in m['currentDarts']]==[60,0,50]
            assert m['currentDarts'][1]['kind']=='miss' and m['currentDarts'][1]['x']>244
            assert len(scene(p)['darts'])==3 and all(s['color']=='#ff703e' for s in scene(p)['darts'])
            assert p.evaluate('window.__originalCanvas===document.querySelector(".dart-canvas")')
            assert len(p.evaluate('window.__writes'))>=6
            p.screenshot(path=str(OUTPUT/'V4-Match.png'))
            # Fourth click is ignored; score/history stay identical.
            before=match(p);throw(p,50,50);assert match(p)==before
            assert p.locator('[data-action=end-turn]').is_enabled()
            check('Native-style autosave, selected dart color, persistent canvas, 3D hits and backstop misses, fourth-dart lock')
            p=restore(p,browser);assert len(scene(p)['darts'])==3 and p.locator('[data-action=end-turn]').is_enabled()
            assert match(p)['activeIndex']==0
            handoff(p);assert match(p)['activeIndex']==1 and len(scene(p)['darts'])==0
            p.locator('[data-action=undo]').click()
            assert match(p)['activeIndex']==0 and len(scene(p)['darts'])==3
            p.locator('[data-action=undo]').click()
            assert match(p)['turnPhase']=='aiming' and len(scene(p)['darts'])==2 and match(p)['players'][0]['score']==441
            assert match(p)['history']==[] and match(p)['players'][0]['turns']==0
            p=restore(p,browser);assert len(scene(p)['darts'])==2 and p.evaluate('DoubleTrouble.isInputReady()')
            check('Relaunch restores mid-turn/handoff; Undo third dart and confirmed handoff restores scores/history/objects')
            # No context teardown during settings and profiles navigation.
            p.evaluate('window.__canvas=document.querySelector(".dart-canvas")')
            p.locator('[data-action=quality]').click()
            assert p.evaluate('window.__canvas===document.querySelector(".dart-canvas")')
            p.locator('[data-action=club]').click()
            p.locator('[data-action=dart-color]').nth(2).click()
            changed=state(p)['profiles'][0]['dartColor']
            p.screenshot(path=str(OUTPUT/'V4-Player-Darts.png'))
            p.locator('[data-action=back-from-club]').click()
            assert p.evaluate('window.__canvas===document.querySelector(".dart-canvas")')
            assert scene(p)['darts'][0]['color']=='#ff703e'
            throw(p,0,-112);assert scene(p)['darts'][-1]['color']==changed
            p.locator('[data-action=history]').click();assert not p.evaluate('DoubleTrouble.isInputReady()')
            p.keyboard.press('Escape');assert not state(p)['ui']['showHistory']
            check('Color edits affect new darts only; scene survives navigation/quality changes; modal Escape')
            p.close()

            # Real animated third dart: save occurs before impact, but handoff waits.
            base=blank_match(browser)
            p=new_page(browser,base,real=True)
            throw(p,0,-112);throw(p,3,-113)
            p.evaluate('window.__canvas=document.querySelector(".dart-canvas")')
            throw(p,-3,-111,wait=False)
            assert match(p)['turnPhase']=='handoff'
            assert p.locator('[data-action=end-turn]').is_disabled()
            assert any(d['flying'] for d in scene(p)['darts'])
            p.screenshot(path=str(OUTPUT/'V4-Flight.png'))
            wait_shot(p);assert p.locator('[data-action=end-turn]').is_enabled()
            assert match(p)['history'][0]['total']==180
            p.screenshot(path=str(OUTPUT/'V4-180.png'))
            handoff(p);throw(p,0,0);assert len(scene(p)['darts'])==1
            p.screenshot(path=str(OUTPUT/'V4-Bull.png'))
            check('Real 3D foreground flight, impact completion gating, 180/bull effects and dart removal')
            p.close()

            # Full 301 double-out, bust on second dart then three-dart checkout.
            p=new_page(browser);p.locator('[data-action=mode][data-value="301"]').click();p.locator('[data-action=double-out]').click();p.locator('[data-action=start]').click()
            for _ in range(3):throw(p)
            assert match(p)['players'][0]['score']==121
            handoff(p);miss_turn(p)
            throw(p);assert match(p)['players'][0]['score']==61
            throw(p);m=match(p)
            assert m['players'][0]['score']==121 and m['turnPhase']=='handoff' and len(m['currentDarts'])==2 and m['history'][0]['bust']
            assert p.locator('[data-action=end-turn]').is_enabled()
            p.locator('[data-action=undo]').click();assert match(p)['players'][0]['score']==61 and len(scene(p)['darts'])==1
            throw(p);handoff(p);miss_turn(p)
            throw(p);throw(p,*target(19));assert match(p)['players'][0]['score']==4
            throw(p,*target(2,185));s=state(p)
            assert s['match']['status']=='finished' and len(s['archives'])==1
            row=s['archives'][0]['players'][0]
            assert row['scored']==301 and row['darts']==8 and row['visits180']==1,row
            assert len(scene(p)['darts'])==3
            p.wait_for_selector('.winner-overlay, .winner-backdrop, .winner-modal',state='visible',timeout=3000) if p.locator('.winner-overlay, .winner-backdrop, .winner-modal').count() else p.wait_for_timeout(100)
            p.screenshot(path=str(OUTPUT/'V4-Victory.png'))
            assert '180' in p.evaluate('DoubleTrouble.earnedAchievements(DoubleTrouble.getState().profiles[0].id).map(x=>x.id)')
            # Winner Undo after closing overlay removes the archive and unlock.
            p.locator('[data-action=close-winner]').click();p.locator('[data-action=undo]').click()
            assert match(p)['status']=='playing' and match(p)['players'][0]['score']==4 and len(state(p)['archives'])==0
            assert p.evaluate('DoubleTrouble.statsFor(DoubleTrouble.getState().profiles[0].id).played')==0
            check('301 double-out: full match, early bust, Undo bust, checkout, single archive and Undo victory')
            p.close()

            # One-dart checkout (bull double) and invalid single finish.
            seed=deepcopy(base);seed['settings']['doubleOut']=True;seed['match']['doubleOut']=True
            seed['match']['players'][0]['score']=50;seed['match']['turnStartScore']=50
            p=new_page(browser,seed,real=True);throw(p,0,0,wait=False)
            assert match(p)['status']=='finished' and len(match(p)['currentDarts'])==1
            # Simulates quitting during winning flight before result overlay appears.
            saved=state(p);p.close();p=new_page(browser,saved)
            assert match(p)['status']=='finished' and len(state(p)['archives'])==1 and state(p)['ui']['showWinner']
            check('Inner bull is a finishing double; quitting during winning flight restores final result once')
            p.close()
            seed=deepcopy(base);seed['match']['doubleOut']=True;seed['match']['players'][0]['score']=20;seed['match']['turnStartScore']=20
            p=new_page(browser,seed);throw(p,*target(20,60))
            assert match(p)['turnBusted'] and match(p)['players'][0]['score']==20 and len(scene(p)['darts'])==1
            check('Invalid single-out in double-out mode immediately busts and enables handoff')
            p.close()

            # Cricket overflow / closure / immediate win after two darts.
            p=new_page(browser);start(p,'CRICKET')
            for _ in range(3):throw(p)
            assert match(p)['players'][0]['marks']['20']==3 and match(p)['players'][0]['score']==120
            handoff(p);miss_turn(p)
            for n in (19,18,17):throw(p,*target(n))
            handoff(p);miss_turn(p)
            throw(p,*target(16));throw(p,*target(15));throw(p,270,0)
            handoff(p);miss_turn(p)
            p.locator('[data-action=cricket-marks]').click();assert state(p)['ui']['showCricket']
            p.keyboard.press('Escape');assert not state(p)['ui']['showCricket']
            throw(p,0,0);throw(p,12,0)
            assert match(p)['status']=='finished' and match(p)['players'][0]['marks']['25']==3
            assert state(p)['archives'][0]['players'][0]['bulls']==1
            check('Cricket overflow points, all closures, marks overlay, two-dart bull checkout')
            p.close()

            # Count Up final round ties, including miss coordinates in archive.
            seed=blank_match(browser,'COUNTUP');seed['match']['countUpRounds']=1
            p=new_page(browser,seed)
            throw(p,0,0);throw(p,12,0);throw(p,270,0);handoff(p)
            throw(p,0,0);throw(p,12,0);throw(p,270,0)
            assert match(p)['status']=='finished' and len(match(p)['winnerIds'])==2
            assert len(state(p)['archives'])==1 and all(x['result']=='draw' for x in state(p)['archives'][0]['players'])
            row=state(p)['archives'][0]['players'][0]
            assert row['misses']==1 and row['hits'][2][0]>244 and row['hits'][2][2:]==[0,0]
            check('Count Up final round finishes without handoff, ties, and archived outside-board coordinates')
            p.close()

            # V3 migration, including original-format summary records, photos/audio, and mid-turn.
            p=new_page(browser,base);throw(p);throw(p,12,0);v3=state(p);p.close()
            v3['schemaVersion']=3;v3['settings'].pop('motion',None);v3['settings'].pop('quality',None)
            for profile in v3['profiles']:profile.pop('dartColor',None)
            from PIL import Image
            from io import BytesIO
            import base64
            img=Image.new('RGB',(32,32),(134,153,101));buf=BytesIO();img.save(buf,format='JPEG')
            photo='data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode()
            v3['profiles'][0]['avatar']=photo;v3['profiles'][0]['walkonAudio']='data:audio/wav;base64,UklGRg=='
            for m in [v3['match']]+v3['match']['undoStack']:
                for key in ('turnPhase','turnCommitted','turnBusted'):m.pop(key,None)
                for shot in m['currentDarts']:shot.pop('id',None);shot.pop('dartColor',None)
            legacy={'id':'legacy-result','game':'501','seasonId':v3['activeSeasonId'],'startedAt':123,'endedAt':456,'winnerIds':[v3['profiles'][0]['id']],
                'players':[{'id':v3['profiles'][0]['id'],'result':'win','darts':9,'scored':501,'bulls':1,'bestVisit':180,'visits180':1,'hits':[[0,-112,20,3]]},
                           {'id':v3['profiles'][1]['id'],'result':'loss','darts':6,'scored':300}]}
            v3['archives']=[legacy]
            p=new_page(browser,v3);s=state(p)
            assert s['schemaVersion']==4 and s['archives']==v3['archives']
            assert s['profiles'][0]['avatar']==photo and s['profiles'][0]['walkonAudio']==v3['profiles'][0]['walkonAudio']
            assert s['match']['players'][0]['score']==416 and s['match']['activeIndex']==0 and len(scene(p)['darts'])==2
            assert all(d['color'] for d in scene(p)['darts'])
            assert p.evaluate('DoubleTrouble.statsFor(DoubleTrouble.getState().profiles[0].id).avg01')==167
            throw(p);assert match(p)['turnPhase']=='handoff'
            check('V3 migration preserves IDs/photos/audio/archives/heatmaps/averages and unfinished two-dart turn')
            # Export / restore via V4, V3, V2 formal backup paths.
            p.evaluate('DoubleTrouble.exportBackup()');exported=json.loads(p.evaluate('window.__exports.at(-1).content'))
            assert exported['backupVersion']==4
            p.evaluate('s=>DoubleTrouble.importBackupJSON(JSON.stringify(s))',exported)
            assert state(p)['profiles']==exported['profiles'] and state(p)['archives']==exported['archives']
            assert state(p)['match']['turnPhase']=='handoff'
            for version in (3,2):
                old=deepcopy(exported);old['backupVersion']=version
                if version==2:
                    old.pop('seasons',None);old.pop('activeSeasonId',None)
                p.evaluate('s=>DoubleTrouble.importBackupJSON(JSON.stringify(s))',old)
                assert len(state(p)['archives'])==1 and len(state(p)['seasons'])==1
            p.locator('[data-action=back-from-club]').click()
            check('V4 backup roundtrip and V2/V3 imports, including season migration')
            p.close()

            # Never silently trim an established club to the old V3 item caps.
            large=deepcopy(v3);large['screen']='setup';large['match']=None
            large['archives']=[dict(deepcopy(legacy),id=f'archive-{i}') for i in range(3002)]
            large['seasons']=[{'id':f'season-{i}','name':f'Season {i}','createdAt':i+1} for i in range(102)]
            large['activeSeasonId']='season-101'
            q=new_page(browser,large)
            assert len(state(q)['archives'])==3002 and len(state(q)['seasons'])==102 and state(q)['activeSeasonId']=='season-101'
            q.close();check('No silent historical truncation beyond old 3000-match / 100-season caps')

            # Real photo upload and bench/reselect keeps player identity/color.
            p=new_page(browser)
            pid=state(p)['profiles'][0]['id']
            p.locator('[data-avatar-input]').first.set_input_files({'name':'test-photo.jpg','mimeType':'image/jpeg','buffer':buf.getvalue()})
            p.wait_for_function('() => DoubleTrouble.getState().profiles[0].avatar!==null')
            assert state(p)['profiles'][0]['avatar'].startswith('data:image/jpeg;base64,')
            p.locator('[data-action=add-player]').click()
            p.locator('[data-action=remove-player]').first.click()
            assert pid not in state(p)['roster']
            p.locator(f'[data-action=join-roster][data-id="{pid}"]').click()
            assert pid in state(p)['roster'] and state(p)['profiles'][0]['avatar']
            check('Photo upload and recurring player bench/reselect retain permanent profile')
            p.close()

            # Three finished matches -> cumulative league/rivalry/achievement records.
            seed=deepcopy(base);seed['match']=None;seed['screen']='setup'
            for i in range(3):
                run=deepcopy(base);run['archives']=deepcopy(seed['archives']);run['match']['id']=f'regression-match-{i}';run['match']['players'][0]['score']=50;run['match']['turnStartScore']=50
                p=new_page(browser,run);throw(p,0,0);seed=state(p);p.close()
            p=new_page(browser,seed);pid=seed['profiles'][0]['id']
            stats=p.evaluate('id=>DoubleTrouble.statsFor(id)',pid)
            assert stats['wins']==3 and stats['played']==3 and stats['longestStreak']==3 and stats['rivalWins']==3
            assert 'streak3' in p.evaluate('id=>DoubleTrouble.earnedAchievements(id).map(a=>a.id)',pid)
            p.locator('[data-action=close-winner]').click();p.locator('[data-action=league]').click()
            p.screenshot(path=str(OUTPUT/'V4-League.png'))
            p.locator('[data-action=league-tab][data-value=rivals]').click()
            assert '3' in p.locator('main').inner_text()
            p.locator('[data-action=league-tab][data-value=awards]').click()
            check('Repeated games aggregate league results, rival wins, streaks, and achievements')
            p.close()

            # Layout bounds on all supported Mac sizes, including smallest content area.
            sizes=[(1440,900),(1280,800),(1024,700),(880,620),(880,590),(390,844)]
            for w,h in sizes:
                p=new_page(browser,base,width=w,height=h)
                bounds=p.evaluate("""() => ({scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],viewport:[innerWidth,innerHeight],
                  controls:[...document.querySelectorAll('.dart-canvas,[data-action=end-turn],#motion-mode')].map(e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom];})})""")
                assert bounds['scroll'][0]<=w+1 and bounds['scroll'][1]<=h+1,(w,h,bounds)
                assert all(b[0]>=-1 and b[1]>=-1 and b[2]<=w+1 and b[3]<=h+1 for b in bounds['controls']),(w,h,bounds)
                if w in (880,390):p.screenshot(path=str(OUTPUT/f'V4-Match-{w}x{h}.png'))
                p.close()
            eight=deepcopy(base)
            for i in range(2,8):
                pr={'id':f'player-{i}','name':f'Player {i+1}','avatar':None,'dartColor':f'#{i}8b79a','createdAt':100}
                eight['profiles'].append(pr);eight['roster'].append(pr['id']);pl=deepcopy(eight['match']['players'][0]);pl['id']=pr['id'];eight['match']['players'].append(pl)
            p=new_page(browser,eight,width=880,height=620)
            p.screenshot(path=str(OUTPUT/'V4-Eight-Players.png'))
            assert p.evaluate('document.documentElement.scrollHeight')<=620
            cards=p.locator('.score-module')
            if cards.count():assert all((cards.nth(i).bounding_box()['y']+cards.nth(i).bounding_box()['height'])<620 for i in range(cards.count()))
            assert p.evaluate("() => [...document.querySelectorAll('.score-module')].every(e=>{const a=e.querySelector('.module-person').getBoundingClientRect(),b=e.querySelector('.module-score').getBoundingClientRect();return a.right<=b.left+1 || a.bottom<=b.top+1;})")
            p.close();check('Viewport-fit layout at six sizes, including 880x590 and 8-player Mac layout')

            # WebGL unavailable: all scoring/turn actions still work and indicator is honest.
            p=new_page(browser,base,fallback=True);assert scene(p)['mode']=='2d'
            throw(p);throw(p,270,0);throw(p,0,0)
            assert match(p)['players'][0]['score']==391 and len(scene(p)['darts'])==3
            handoff(p);assert match(p)['activeIndex']==1
            p.close();check('Explicit 2D compatibility fallback with identical scoring and turn rules')
            assert not ERRORS,ERRORS
            check('Zero uncaught JavaScript errors in integration run')
            browser.close()
    finally:
        if xvfb:xvfb.terminate()
        report={'passed':RESULTS,'errors':ERRORS,'environment':'Linux Chromium, software WebGL2, fake native save/export bridge. Not a macOS executable test.'}
        (OUTPUT/'results.json').write_text(json.dumps(report,indent=2))
    print(f'ALL {len(RESULTS)} GROUPS PASSED',flush=True)

if __name__=='__main__': main()
