'use strict';
// The toolbar button and its shortcut open the side panel. Nothing here touches tabs' contents: the extension has no host permissions (PRD F9).
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(e=>console.error(e));
// First install only: a short page on pinning the button and opening the panel. Opening a tab needs no permission.
chrome.runtime.onInstalled.addListener(({reason})=>{if(reason==='install')chrome.tabs.create({url:'welcome.html'});});
