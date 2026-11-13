(() => {
  if (window !== window.top) return;

  // The Android shell already reserves system bar space. Remove only the empty
  // safe-area spacers in Tipsy's mobile navigation and the matching root offset.
  const footer = 'div:has(> .h-14.justify-around > a[href="/create"]):has(> .h-14.justify-around > a[href="/chat/recent"])';
  const topSpacer = 'div[class~="pb-[env(safe-area-inset-top,0)]"]:empty';
  const bottomSpacer = 'div[class~="pb-[env(safe-area-inset-bottom,0)]"]:empty';
  const mobileFooter = footer + ':has(> ' + topSpacer + '):has(> ' + bottomSpacer + ')';
  const mobileRoot = 'html:has(.h-14.justify-around > a[href="/chat/recent"])'
    + ':has(.h-14.justify-around + ' + topSpacer + ' + ' + bottomSpacer + ')';

  function install() {
    const style = document.createElement('style');
    style.id = 'roleleaf-tipsy-viewport';
    style.textContent = `
      ${mobileRoot} { min-height: 0 !important; }
      ${mobileFooter} > :is(${topSpacer}, ${bottomSpacer}) { display: none !important; }
    `;
    document.head.append(style);
  }

  if (document.head) install();
  else {
    const observer = new MutationObserver(() => {
      if (!document.head) return;
      observer.disconnect();
      install();
    });
    observer.observe(document, { childList: true, subtree: true });
  }
})();
