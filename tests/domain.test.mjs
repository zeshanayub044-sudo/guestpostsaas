import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveInterval,duration,csv} from '../src/domain.js';
test('100 targets default to a 2h 28m 30s minimum span',()=>{assert.equal(effectiveInterval(100,90),90);assert.equal(duration(99*90),'2h 28m 30s');});
test('every campaign with 100+ targets spans at least two hours',()=>{for(let n=100;n<=1000;n++){const gap=effectiveInterval(n,30);assert.ok(gap*(n-1)>=7200);}});
test('small campaigns and slower configured schedules are preserved',()=>{assert.equal(effectiveInterval(99,30),30);assert.equal(effectiveInterval(100,180),180);assert.equal(effectiveInterval(1,90),90);});
test('invalid counts and intervals are rejected',()=>{for(const [n,gap]of[[0,90],[1001,90],[1,29],[1,86401],[1,90.5]])assert.throws(()=>effectiveInterval(n,gap));});
test('CSV neutralizes formulas and escapes quoted multiline content',()=>{const output=csv([{title:'=HYPERLINK("bad")',error:'two\nlines, "quoted"'}]);assert.ok(output.includes('"\'=HYPERLINK(""bad"")"'));assert.ok(output.includes('"two\nlines, ""quoted"""'));});
