/**
 * Entry point. Loaded last, after every other js/hmi/ file.
 *
 * Installation waits for EditorUi to exist, because PostConfig.js runs before
 * App.main in some paths. Everything it installs is a prototype override, so
 * it must run before the first EditorUi is constructed but after the classes
 * it wraps are defined.
 */
Hmi = function() {};

Hmi.VERSION = '0.1.0';

Hmi.installed = false;

Hmi.install = function()
{
	if (Hmi.installed || typeof EditorUi === 'undefined')
	{
		return Hmi.installed;
	}

	Hmi.installed = true;

	HmiResources.install();
	HmiBrand.install();
	HmiFile.install();
	HmiFormat.install();
	HmiMenus.install();
	HmiFrame.install();
	HmiAlarms.install();
	HmiRecipes.install();
	HmiArc.install();
	HmiFlip.install();
	Hmi.captureUi();

	HmiLog.log('HMI module ' + Hmi.VERSION + ' installed');

	return true;
};

/**
 * Keeps a reference to the live EditorUi. The HMI code itself is handed the ui
 * by the overrides it installs; this is for the self test and the console.
 */
Hmi.captureUi = function()
{
	var editorUiInit = EditorUi.prototype.init;

	EditorUi.prototype.init = function()
	{
		editorUiInit.apply(this, arguments);

		Hmi.ui = this;
		HmiLog.guard('brand.init', mxUtils.bind(this, function() { HmiBrand.afterInit(this); }));

		// Marks the editor's graph, the only one that gets the screen frame.
		this.editor.graph.hmiUi = this;
		HmiFrame.refresh(this);

		// Command-line check or publish (--hmi-check, --hmi-publish)
		if (HmiCli.isActive())
		{
			var cliUi = this;

			window.setTimeout(function()
			{
				HmiLog.guard('cli.start', function() { HmiCli.start(cliUi); });
			}, 0);
		}

		// A published package: open its project straight into Run
		if (HmiRuntimeApp.isActive())
		{
			var ui = this;

			window.setTimeout(function()
			{
				HmiLog.guard('runtime.start', function() { HmiRuntimeApp.start(ui); });
			}, 0);
		}

		if (typeof HmiSelfTest !== 'undefined')
		{
			HmiSelfTest.ui = this;

			if (urlParams['hmifile'] != null)
			{
				window.setTimeout(function()
				{
					HmiSelfTest.results = [];
					HmiSelfTest.runFile(Hmi.ui,
						decodeURIComponent(urlParams['hmifile']));
				}, 2500);
			}

			if (urlParams['hmilive'] == '1')
			{
				window.setTimeout(function() { HmiSelfTest.runLive(Hmi.ui); }, 2500);
			}

			if (urlParams['hmidemo'] == '1')
			{
				window.setTimeout(function() { HmiSelfTest.demo(Hmi.ui); }, 2000);
			}

			if (urlParams['hmitest'] == '1')
			{
				// After the first layout, so the format panel has a width and
				// immediateRefresh does not bail out.
				window.setTimeout(function() { HmiSelfTest.run(Hmi.ui); }, 2000);
			}
		}
	};
};

/**
 * PostConfig.js runs while the editor classes may still be loading, so poll
 * briefly rather than assuming an order we do not control.
 */
Hmi.boot = function()
{
	if (Hmi.install())
	{
		return;
	}

	var tries = 0;

	var timer = window.setInterval(function()
	{
		if (Hmi.install() || ++tries > 100)
		{
			window.clearInterval(timer);

			if (!Hmi.installed)
			{
				HmiLog.warn('EditorUi never appeared; HMI features disabled');
			}
		}
	}, 50);
};

Hmi.boot();
