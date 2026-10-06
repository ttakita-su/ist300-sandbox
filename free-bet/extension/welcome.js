'use strict';
// sidePanel.open() needs the click's user gesture, so the window id is looked up before the click rather than awaited inside it.
let windowId=null;
chrome.tabs.getCurrent().then(t=>{windowId=t?.windowId??null;});
document.getElementById('open').addEventListener('click',()=>{
 const shown=windowId===null?Promise.reject(new Error('No window yet')):chrome.sidePanel.open({windowId});
 shown.catch(()=>{document.getElementById('openError').hidden=false;});
});
chrome.commands.getAll().then(list=>{const c=list.find(x=>x.name==='_execute_action');if(c?.shortcut)document.getElementById('shortcut').textContent=`or press ${c.shortcut}`;});
