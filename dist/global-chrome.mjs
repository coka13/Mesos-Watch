
const donate=document.getElementById('donation-dialog');
document.getElementById('global-donate').addEventListener('click',()=>donate.showModal());
donate.addEventListener('click',event=>{if(event.target===donate){const rect=donate.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)donate.close();}});

// Layout-only ad previews. No ad SDK, tracking, or network requests.
for(const view of document.querySelectorAll('main>.view')){
 const placement=document.createElement('aside');placement.className='google-ad-mock page-ad-mock';placement.setAttribute('aria-label','Google Ads mock placement');
 const label=document.createElement('span');label.className='mock-ad-label';label.textContent='ADVERTISEMENT';
 const text=document.createElement('span');text.className='mock-ad-title';text.textContent='Google Ads · '+(view.dataset.view==='checker'?'market guide':(view.querySelector('h1')?.textContent||'page'))+' placement';
 const size=document.createElement('span');size.className='mock-ad-size';size.textContent='Responsive ad space · mock only';placement.append(label,text,size);
 if(view.dataset.view==='checker')document.getElementById('home-panel-guide').append(placement);else view.append(placement);
}

// Each route gets the same fixed content area; optional sections have their own tabs.
for(const view of document.querySelectorAll('main>.view:not([data-view="checker"])')){
 const content=document.createElement('div');content.className='route-content';
 for(const child of [...view.children])if(!child.classList.contains('page-head'))content.append(child);
 view.append(content);
 const key=view.dataset.view;
 const sections=key==='store'?[content.querySelector('.workspace'),content.querySelector('#sale-activity')]:key==='opportunities'?[...content.querySelectorAll(':scope>.panel')]:key==='settings'?[content.querySelector('.activity'),content.querySelector('.privacy')]:[];
 if(sections.length===2&&sections.every(Boolean)){
  const labels=key==='store'?['Watch my shop','Sales history']:key==='opportunities'?['Profit calculator','Market opportunities']:['Browser data','Privacy & sources'];
  const tabs=document.createElement('div');tabs.className='route-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',view.querySelector('h1').textContent+' sections');
  const frame=document.createElement('div');frame.className='route-tab-frame';const panels=[];const buttons=[];
  function pick(index){panels.forEach((panel,i)=>{panel.hidden=i!==index;buttons[i].setAttribute('aria-selected',String(i===index));buttons[i].tabIndex=i===index?0:-1;if(i===index)panel.scrollTop=0;});}
  sections.forEach((section,i)=>{
   const panel=document.createElement('div');panel.className='route-tab-panel';panel.id='route-'+key+'-panel-'+i;panel.setAttribute('role','tabpanel');panel.tabIndex=0;
   const button=document.createElement('button');button.type='button';button.id='route-'+key+'-tab-'+i;button.textContent=labels[i];button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);panel.setAttribute('aria-labelledby',button.id);
   button.addEventListener('click',()=>pick(i));button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-i;pick(next);buttons[next].focus();}});
   if(section.tagName==='DETAILS')section.open=true;
   panel.append(section);frame.append(panel);tabs.append(button);panels.push(panel);buttons.push(button);
  });content.prepend(tabs,frame);pick(0);
 }
}
const locationSection=document.querySelector('.scan-location');
if(locationSection){const details=document.createElement('details');details.className='scan-location-details';const summary=document.createElement('summary');summary.textContent='Location & reading details';locationSection.before(details);details.append(summary,locationSection);}
const steps=[...document.querySelectorAll('#watcher .steps>details')];
steps.forEach((step,index)=>{step.open=index===0;step.addEventListener('toggle',()=>{if(step.open)for(const other of steps)if(other!==step)other.open=false;});});

function resetRouteScroll(){requestAnimationFrame(()=>{const view=document.querySelector('main>.view:not([hidden])');if(!view)return;for(const node of [view,...view.querySelectorAll('.route-content,.route-tab-panel:not([hidden])')])node.scrollTop=0;});}
window.addEventListener('mesoswatch:view',resetRouteScroll);resetRouteScroll();
