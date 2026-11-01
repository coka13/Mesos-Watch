import assert from 'node:assert/strict';import {calculateTrade} from '../dist/trading.mjs';
let r=calculateTrade({buy:100,sell:200,quantity:3,feePercent:5});assert.deepEqual([r.cost,r.gross,r.fees,r.revenue,r.profit,r.breakEven],[300,600,30,570,270,106]);assert.equal(r.roi,90);
r=calculateTrade({buy:0,sell:10,quantity:1,feePercent:100});assert.equal(r.roi,null);assert.equal(r.margin,null);assert.equal(r.breakEven,null);
for(const patch of [{quantity:0},{quantity:1.5},{buy:-1},{feePercent:101},{sell:NaN}])assert.throws(()=>calculateTrade({buy:100,sell:200,quantity:1,feePercent:5,...patch}));
for(const feePercent of [0,2.5,99.9]){r=calculateTrade({buy:100,sell:200,quantity:3,feePercent,flatFee:5});assert.ok(r.breakEven*3-Math.ceil(r.breakEven*3*feePercent/100)-5>=300);assert.ok((r.breakEven-1)*3-Math.ceil((r.breakEven-1)*3*feePercent/100)-5<300);}
console.log('Trading: net revenue, ROI, fees, break-even rounding and invalid inputs passed.');
