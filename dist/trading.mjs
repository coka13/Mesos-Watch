export function calculateTrade({buy,sell,quantity,feePercent,flatFee=0}){
 if(![buy,sell,quantity,feePercent,flatFee].every(Number.isFinite)||buy<0||sell<0||!Number.isSafeInteger(quantity)||quantity<1||quantity>9999||feePercent<0||feePercent>100||flatFee<0||buy>1e11||sell>1e11)throw Error('Enter nonnegative prices, quantity 1–9999 and fees from 0–100%.');
 const cost=buy*quantity,gross=sell*quantity,fees=Math.ceil(gross*feePercent/100)+flatFee,revenue=gross-fees,profit=revenue-cost;
 if(![cost,gross,fees,profit].every(Number.isSafeInteger))throw Error('Prices and fees must resolve to safe whole mesos amounts.');
 let breakEven=null;
 if(feePercent<100){breakEven=Math.ceil((cost+flatFee)/(quantity*(1-feePercent/100)));while(breakEven*quantity-Math.ceil(breakEven*quantity*feePercent/100)-flatFee<cost)breakEven++;}
 return{cost,gross,fees,revenue,profit,roi:cost>0?profit/cost*100:null,margin:revenue>0?profit/revenue*100:null,breakEven};
}
