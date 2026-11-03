// Payment rules for PayPal and crypto: input checks, order references, amounts and the NOWPayments IPN signature.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {checkSponsor,checkDonation,orderRef,parseOrderRef,toCents,sortKeys,verifyNowPayments,paypalPaid,cryptoPaid} from '../supabase/functions/_shared/pay-rules.js';

// Sponsor banners: https only, no credentials in links, titles cleaned of control and bidi characters.
assert.deepEqual(checkSponsor({title:' Steely‮ Shop ',url:'https://example.com/shop'}),{title:'Steely Shop',url:'https://example.com/shop',image_url:null,errors:[]});
assert.equal(checkSponsor({title:'Ok',url:'http://example.com'}).errors.length,1);
assert.equal(checkSponsor({title:'Ok',url:'javascript:alert(1)'}).errors.length,1);
assert.equal(checkSponsor({title:'Ok',url:'https://user:pw@example.com'}).errors.length,1);
assert.equal(checkSponsor({title:'Ok',url:'https://example.com',image_url:'data:image/png;base64,AAA'}).errors.length,1);
assert.equal(checkSponsor({title:'x',url:'https://example.com'}).errors.length,1);

// Donations: whole dollars within the limits; the browser cannot pick a fractional or huge amount.
assert.equal(checkDonation({amount:5}).amount_cents,500);assert.deepEqual(checkDonation({amount:5}).errors,[]);
for(const bad of [0,0.5,2.5,501,'abc',-3])assert.equal(checkDonation({amount:bad}).errors.length,1,'rejects '+bad);
assert.equal(checkDonation({amount:3,public:'yes'}).public,false,'only a real true shows the name');

// Order references round-trip and refuse anything else.
const id='0f8fad5b-d9cb-469f-a165-70867728950e';
assert.deepEqual(parseOrderRef(orderRef('sponsor',id)),{kind:'sponsor',id});
for(const bad of ['sponsor:1','other:'+id,'sponsor:'+id+'x',null])assert.equal(parseOrderRef(bad),null);
assert.equal(toCents('12.34'),1234);assert.equal(toCents('7'),700);assert.equal(toCents('1.5'),150);
for(const bad of ['1.234','-1','1e3','',null])assert.equal(toCents(bad),null);

// NOWPayments IPN signature: HMAC-SHA512 over JSON with keys sorted at every level; constant-time compare.
const ipn={payment_status:'finished',order_id:orderRef('megaphone',id),price_amount:1.99,price_currency:'usd',payment_id:5077125051,invoice_id:4522625843,nested:{b:2,a:1}};
const sig=createHmac('sha512','ipn-secret').update(JSON.stringify(sortKeys(ipn))).digest('hex');
assert.equal(JSON.stringify(sortKeys(ipn)).indexOf('"invoice_id"')<JSON.stringify(sortKeys(ipn)).indexOf('"nested"'),true);
assert.equal(await verifyNowPayments(ipn,sig,'ipn-secret'),true);
assert.equal(await verifyNowPayments({...ipn,price_amount:0.01},sig,'ipn-secret'),false,'tampered body');
assert.equal(await verifyNowPayments(ipn,sig,'other-secret'),false,'wrong secret');
assert.equal(await verifyNowPayments(ipn,'',''),false,'no secret configured');

// Provider confirmations must be complete, for this row, in USD, for the full price.
const row={ref:orderRef('megaphone',id),price_cents:199,livemode:false};
const order=(over={})=>({status:'COMPLETED',purchase_units:[{custom_id:row.ref,payments:{captures:[{id:'CAP1',status:'COMPLETED',amount:{currency_code:'USD',value:'1.99'}}]}}],...over});
assert.deepEqual(paypalPaid(order(),row),{ok:true,payment:'CAP1',livemode:false});
assert.equal(paypalPaid({...order(),purchase_units:[{custom_id:row.ref,payments:{captures:[{status:'COMPLETED',amount:{currency_code:'USD',value:'0.99'}}]}}]},row).ok,false,'underpaid');
assert.equal(paypalPaid({...order(),purchase_units:[{custom_id:'megaphone:other',payments:{captures:[{status:'COMPLETED',amount:{currency_code:'USD',value:'1.99'}}]}}]},row).ok,false,'other order');
assert.equal(paypalPaid({...order(),purchase_units:[{custom_id:row.ref,payments:{captures:[{status:'PENDING',amount:{currency_code:'USD',value:'1.99'}}]}}]},row).pending,true);
assert.equal(paypalPaid({...order(),purchase_units:[{custom_id:row.ref,payments:{captures:[{status:'COMPLETED',amount:{currency_code:'EUR',value:'1.99'}}]}}]},row).ok,false,'currency');
assert.deepEqual(cryptoPaid(ipn,row),{ok:true,payment:'crypto:5077125051'});
assert.equal(cryptoPaid({...ipn,payment_status:'partially_paid'},row).ok,false,'partial payment never activates');
assert.equal(cryptoPaid({...ipn,price_amount:1.5},row).ok,false,'invoice for less than the price');
assert.equal(cryptoPaid({...ipn,order_id:orderRef('donation',id)},row).ok,false,'other order');
console.log('Payment rules: sponsor and donation input, order references, NOWPayments signature, PayPal and crypto confirmation: ok');
