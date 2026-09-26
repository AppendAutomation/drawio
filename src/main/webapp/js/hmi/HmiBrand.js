/**
 * Append HMI Studio branding over the draw.io editor it is built on.
 *
 * Upstream files stay as they ship, apart from index.html, the desktop check
 * in bootstrap.js (and its copies in export.js and vsdxImporter.js) and one
 * file filter name in ElectronApp.js. Everything the desktop app shows is
 * patched from here. The draw.io licence and attribution stay reachable from
 * Help > About, as the Apache License requires.
 */
HmiBrand = function() {};

HmiBrand.NAME = 'Append HMI Studio';

HmiBrand.PUBLISHER = 'Append Automation';

HmiBrand.HOMEPAGE = 'https://github.com/AppendAutomation/append-hmi-studio';

HmiBrand.ISSUES = HmiBrand.HOMEPAGE + '/issues';

HmiBrand.LOGO = 'images/hmi-logo.svg';

/** Upstream's sites. Links there are not opened (help, docs, support). */
HmiBrand.UPSTREAM_LINK = new RegExp('^https?://(([a-z0-9-]+\\.)*(drawio\\.com|draw\\.io|' +
	'diagrams\\.net|jgraph\\.com)(/|$)|(www\\.)?github\\.com/jgraph/)', 'i');

HmiBrand.isUpstreamLink = function(href)
{
	return typeof href === 'string' && HmiBrand.UPSTREAM_LINK.test(href);
};

/**
 * Before the editor is built: names, logo, export comments, help icons and
 * links. Every name patched here survives in the minified bundles.
 */
HmiBrand.install = function()
{
	// Window title "<file> - Append HMI Studio"
	Editor.prototype.appName = HmiBrand.NAME;
	Editor.logoImage = HmiBrand.LOGO;

	Graph.svgFileComment = '<!-- Created with ' + HmiBrand.NAME + ' -->';
	Graph.foreignObjectWarningLink = HmiBrand.HOMEPAGE;

	// The "?" icons all lead to upstream's documentation
	EditorUi.prototype.createHelpIcon = function()
	{
		var icon = document.createElement('span');
		icon.style.display = 'none';

		return icon;
	};

	// Anything that still links upstream opens nothing
	var graphOpenLink = Graph.prototype.openLink;

	Graph.prototype.openLink = function(href)
	{
		if (HmiBrand.isUpstreamLink(href))
		{
			HmiLog.warn('link not opened: ' + href);

			return null;
		}

		return graphOpenLink.apply(this, arguments);
	};

	var editorUiOpenLink = EditorUi.prototype.openLink;

	EditorUi.prototype.openLink = function(href)
	{
		if (HmiBrand.isUpstreamLink(href))
		{
			HmiLog.warn('link not opened: ' + href);

			return null;
		}

		return editorUiOpenLink.apply(this, arguments);
	};

	// The tab bar ends with a link to upstream's repository
	var updateTabContainer = EditorUi.prototype.updateTabContainer;

	EditorUi.prototype.updateTabContainer = function()
	{
		updateTabContainer.apply(this, arguments);

		HmiLog.guard('brand.tabs', mxUtils.bind(this, function()
		{
			var root = (this.tabContainer != null) ? this.tabContainer : document;
			var links = root.querySelectorAll('a[href*="github.com/jgraph"]');

			for (var i = 0; i < links.length; i++)
			{
				links[i].parentNode.removeChild(links[i]);
			}
		}));
	};

	if (typeof App !== 'undefined')
	{
		// The logo top left opened upstream's website
		App.prototype.appIconClicked = function(evt)
		{
			mxEvent.consume(evt);
		};
	}

	// The New dialog heads the built-in templates 'draw.io' when other
	// template categories exist
	if (typeof NewDialog !== 'undefined')
	{
		var BaseNewDialog = NewDialog;
		var proto = BaseNewDialog.prototype;

		NewDialog = function()
		{
			BaseNewDialog.apply(this, arguments);

			HmiLog.guard('brand.newDialog', mxUtils.bind(this, function()
			{
				HmiBrand.replaceText(this.container, 'draw.io', HmiBrand.NAME);
			}));
		};

		NewDialog.prototype = proto;

		for (var key in BaseNewDialog)
		{
			if (Object.prototype.hasOwnProperty.call(BaseNewDialog, key))
			{
				NewDialog[key] = BaseNewDialog[key];
			}
		}
	}

	HmiBrand.installActions();
	HmiBrand.installHelpMenu();
};

/** Replaces text in the text nodes under node. */
HmiBrand.replaceText = function(node, from, to)
{
	if (node == null)
	{
		return;
	}

	var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);

	while (walker.nextNode())
	{
		var t = walker.currentNode;

		if (t.nodeValue.indexOf(from) >= 0)
		{
			t.nodeValue = t.nodeValue.split(from).join(to);
		}
	}
};

/**
 * After the editor is built, when the language bundle has been parsed (it
 * would overwrite these if they were set earlier).
 */
HmiBrand.afterInit = function(ui)
{
	var n = HmiBrand.NAME;

	mxResources.parse([
		'draw.io=' + n,
		'configLinkWarn=This link configures ' + n + '. Only click OK if you trust whoever gave you it!',
		'configLinkConfirm=Click OK to configure and restart ' + n + '.',
		'promptTooLarge=Only {1} characters allowed',
		'tryOpeningViaThisPage=Try opening the file from ' + n + '.',
		'cfgCompressStylesHelp=Deduplicate repeated inline images and stencils into a shared lookup table.',
		'cfgCssHelp=CSS rules to customize the user interface'
	].join('\n'));

	// The macOS app menu's About item
	if (window.electron != null && typeof window.electron.registerMsgListener === 'function')
	{
		window.electron.registerMsgListener('hmiShowAbout', function()
		{
			HmiDialogs.showAbout(ui);
		});
	}
};

HmiBrand.installActions = function()
{
	var actionsInit = Actions.prototype.init;

	Actions.prototype.init = function()
	{
		actionsInit.apply(this, arguments);

		HmiLog.guard('brand.actions', mxUtils.bind(this, function()
		{
			var ui = this.editorUi;

			this.addAction('hmiUserGuide...', function()
			{
				ui.openLink(HmiBrand.HOMEPAGE);
			});

			this.addAction('hmiReportProblem...', function()
			{
				ui.openLink(HmiBrand.ISSUES);
			});

			this.addAction('hmiAbout...', function()
			{
				HmiDialogs.showAbout(ui);
			});

			this.put('hmiZoomIn', new Action(mxResources.get('zoomIn'), function()
			{
				ui.desktopZoomIn();
			}));

			this.put('hmiZoomOut', new Action(mxResources.get('zoomOut'), function()
			{
				ui.desktopZoomOut();
			}));

			this.put('hmiResetZoom', new Action(mxResources.get('actualSize'), function()
			{
				ui.desktopResetZoom();
			}));
		}));
	};
};

/**
 * Help: this product's guide, problem reports, zoom and About. Upstream's
 * help search, videos, website and support links are not offered.
 */
HmiBrand.installHelpMenu = function()
{
	var menusInit = Menus.prototype.init;

	Menus.prototype.init = function()
	{
		menusInit.apply(this, arguments);

		HmiLog.guard('brand.help', mxUtils.bind(this, function()
		{
			var ui = this.editorUi;

			this.put('help', new Menu(mxUtils.bind(this, function(menu, parent)
			{
				// Action keys without the trailing '...' (see HmiMenus.installMenu)
				this.addMenuItems(menu, ['hmiUserGuide', 'hmiReportProblem'], parent);

				if (ui.desktopZoomIn != null)
				{
					this.addMenuItems(menu, ['-', 'hmiResetZoom', 'hmiZoomIn', 'hmiZoomOut'], parent);
				}

				if (urlParams['dev'] == '1' || urlParams['test'] == '1')
				{
					this.addMenuItems(menu, ['-', 'openDevTools'], parent);
				}

				this.addMenuItems(menu, ['-', 'hmiAbout'], parent);

				if (urlParams['test'] == '1')
				{
					menu.addSeparator(parent);
					this.addSubmenu('testDevelop', menu, parent);
				}
			})));
		}));
	};
};
