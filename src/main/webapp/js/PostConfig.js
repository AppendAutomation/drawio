/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// null'ing of global vars need to be after init.js
window.ICONSEARCH_PATH = null;
window.ICON_SERVICE_PATH = null;

// ---------------------------------------------------------------------------
// Append HMI Studio loader.
//
// PostConfig.js is the only file loaded last in BOTH the dev and the packaged
// branch of bootstrap.js, and it is not under any directory the electron-builder
// configs exclude. Loading the HMI code here therefore avoids regenerating the
// committed js/app.min.js, which would otherwise become a 9.7MB merge conflict
// on every upstream bump.
//
// mxscript() is deliberately not used: in the packaged branch it inserts each
// script BEFORE document.scripts[0], which after the first insertion is the
// script just inserted -- so repeated calls produce reverse document order.
//
// Note that `defer` does NOT order these: it is honoured only for scripts
// present during the initial HTML parse, and a dynamically inserted script is
// async by default. `async = false` is the switch that forces dynamically
// inserted scripts to execute in insertion order.
// ---------------------------------------------------------------------------
(function()
{
	var head = document.getElementsByTagName('head')[0];

	var css = document.createElement('link');
	css.setAttribute('rel', 'stylesheet');
	css.setAttribute('href', 'css/hmi.css');
	head.appendChild(css);

	// Hmi.js installs everything and must come last. The sources are loaded
	// as they are in every build (there is no minified bundle); the self test
	// only in dev/test runs.
	var files = ['HmiLog.js', 'HmiTypes.js', 'HmiProject.js', 'HmiFile.js',
		'HmiResources.js', 'HmiExpr.js', 'HmiSimulator.js', 'HmiComms.js', 'HmiCommsDriver.js', 'HmiRuntime.js', 'HmiAlarms.js', 'HmiRetentive.js',
		'HmiWindows.js', 'HmiFrame.js',
		'HmiFormatPanel.js', 'HmiLinkPanels.js', 'HmiFormat.js',
		'HmiDialogs.js', 'HmiMenus.js', 'HmiRuntimeApp.js', 'HmiBrand.js', 'HmiCli.js'];

	if (urlParams['dev'] == '1' || urlParams['test'] == '1')
	{
		files.push('HmiSelfTest.js');
	}

	files.push('Hmi.js');

	for (var i = 0; i < files.length; i++)
	{
		var s = document.createElement('script');
		s.setAttribute('type', 'text/javascript');
		s.async = false;
		s.setAttribute('src', 'js/hmi/' + files[i]);
		head.appendChild(s);
	}
})();
