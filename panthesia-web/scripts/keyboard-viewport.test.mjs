import {test} from 'node:test';import assert from 'node:assert/strict';import{build}from'esbuild';import{fileURLToPath}from'node:url';
const result=await build({entryPoints:[fileURLToPath(new URL('../src/features/practice/keyboardViewport.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
const v=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('saved camera accepts old backups and preserves explicit shortcut assignments',async()=>{
 const bundled=await build({stdin:{contents:"export * from './src/features/settings/interfaceBackupModel'; export * from './src/displayPreferences'; export * from './src/shortcuts';",resolveDir:fileURLToPath(new URL('..',import.meta.url))},bundle:true,write:false,format:'esm',platform:'node'});
 const m=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
 const prefs=m.normalizeDisplayPreferences({...m.displayDefaults,range:'custom',keyboardViewport:{start:12.125,span:28.75},previewBars:2.25});
 const raw={format:'neothesia-interface-settings',version:1,createdAt:new Date().toISOString(),preferences:prefs,layouts:[]};
 assert.deepEqual(m.decodeInterfaceBackup(JSON.stringify(raw)).preferences.keyboardViewport,prefs.keyboardViewport);
 delete raw.preferences.keyboardViewport;
 assert.equal(m.decodeInterfaceBackup(JSON.stringify(raw)).preferences.keyboardViewport,null);
 const shortcuts=m.normalizeShortcuts({playPause:'PageUp'},[]);
 assert.equal(shortcuts.playPause,'PageUp');assert.equal(shortcuts.previewMore,null);
});
test('fractional camera preserves its anchor, clipped black keys, and MIDI bounds',()=>{
 const view=v.viewportFromRange({low:21,high:108}),anchor=.31;
 assert.deepEqual(v.viewportRange(view),{low:21,high:108});
 assert.equal(v.keyboardLayout(view).length,88);
 const zoom=v.zoomKeyboardViewport(view,.993,anchor);
 assert.ok(Math.abs(zoom.start+zoom.span*anchor-view.start-view.span*anchor)<1e-10);
 assert.ok(!Number.isInteger(zoom.start));assert.ok(!Number.isInteger(zoom.span));
 const keys=v.keyboardLayout({start:.9,span:8});const black=keys.find(k=>k.pitch===1),white=keys.find(k=>k.pitch===0);
 assert.ok(black.x<0&&black.x+black.w>0);assert.ok(white.x<0&&white.x+white.w>0);
 const high=v.clampKeyboardViewport(1000,8);assert.equal(high.start+high.span,75);
 const low=v.panKeyboardViewport(view,-1000);assert.equal(low.start,0);
 const full=v.zoomKeyboardViewport(view,100);assert.deepEqual(v.viewportRange(full),{low:0,high:127});
 const settings={range:'custom',keyboardLow:21,keyboardHigh:108,keyboardDeviceRanges:{},keyboardViewport:zoom};
 assert.deepEqual(v.resolveKeyboardViewport(settings,[],null),zoom);
 assert.deepEqual(v.resolveKeyboardViewport({...settings,range:88},[],null),view);
});
test('fractional preview spans compound and changing measures without changing song time',()=>{
 const measures=[{startTick:0,endTick:720},{startTick:720,endTick:2640},{startTick:2640,endTick:4080}];
 assert.equal(v.previewTickSpan(measures,0,1.5),1680);assert.equal(v.previewTickSpan(measures,1,.5),960);
 assert.equal(v.previewTickSpan(measures,2,2),2880);assert.equal(v.normalizePreviewBars(.1),.5);assert.equal(v.normalizePreviewBars(40),16);
});
