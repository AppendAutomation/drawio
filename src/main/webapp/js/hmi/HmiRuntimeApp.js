/**
 * The published package's renderer (run-only mode, see the desktop app's
 * src/main/runtime/RuntimeMode.js). The page is opened chromeless with
 * hmiruntime=1; this asks the main process for the bundled project, loads it
 * and starts Run filling the window. Nothing here can save or edit.
 */
HmiRuntimeApp = function() {};

HmiRuntimeApp.isActive = function()
{
	return urlParams['hmiruntime'] == '1' && window.electron != null &&
		typeof window.electron.request === 'function';
};

HmiRuntimeApp.request = function(action, args)
{
	return new Promise(function(resolve, reject)
	{
		var msg = args || {};
		msg.action = action;

		window.electron.request(msg, resolve, function(message)
		{
			reject(new Error(message));
		});
	});
};

/** Also written to the runtime's log file in its userData folder. */
HmiRuntimeApp.log = function(level, message)
{
	HmiRuntimeApp.request('hmiRuntime.log', {level: level, message: message})
		['catch'](function() {});
};

HmiRuntimeApp.start = function(ui)
{
	HmiRuntimeApp.ui = ui;
	document.body.classList.add('hmiRuntimeMode');

	// The exit shortcut is caught in the main process, which asks for the
	// password here when the project wants one
	window.electron.registerMsgListener('hmiRuntimeExitPrompt', function()
	{
		HmiRuntimeApp.promptExit(ui);
	});

	HmiRuntimeApp.request('hmiRuntime.info').then(function(info)
	{
		HmiRuntimeApp.info = info;

		if (info.error != null)
		{
			throw new Error(info.error);
		}

		return HmiRuntimeApp.request('hmiRuntime.project');
	}).then(function(project)
	{
		HmiRuntimeApp.load(ui, project);
	})['catch'](function(e)
	{
		HmiRuntimeApp.fail(e.message);
	});
};

HmiRuntimeApp.load = function(ui, project)
{
	// No fileObject: the file has no path, so nothing can save, draft or
	// watch it
	var file = new LocalFile(ui, project.xml, project.title, true);
	ui.fileLoaded(file);

	// The window (or browser tab) is named after the application
	var name = (HmiRuntimeApp.info != null && HmiRuntimeApp.info.productName) || project.title;
	ui.updateDocumentTitle = function() { document.title = name; };
	ui.updateDocumentTitle();

	if (ui.getCurrentFile() !== file || ui.hmiProject == null)
	{
		throw new Error('The project could not be opened.');
	}

	HmiMenus.start(ui, {runtime: true});

	if (HmiMenus.isRunning(ui))
	{
		HmiRuntimeApp.started(ui, project);
	}
	else if (ui.hmiStarting)
	{
		// Retentive values are read first; Run starts once they are in
		var listener = function(sender, evt)
		{
			if (evt.getProperty('running'))
			{
				ui.removeListener(listener);
				HmiLog.guard('runtime.started', function() { HmiRuntimeApp.started(ui, project); });
			}
		};

		ui.addListener('hmiRunStateChanged', listener);
	}
	else
	{
		throw new Error('The project could not be started. See the log for details.');
	}
};

HmiRuntimeApp.started = function(ui, project)
{
	ui.hmiRuntime.setView(HmiRuntimeApp.initialView());

	// A browser gets a menu to change it (hmiviewmenu=1, Append HMI Web)
	if (urlParams['hmiviewmenu'] == '1')
	{
		HmiRuntimeApp.showViewMenu(ui);
	}

	var p = ui.hmiProject;
	HmiRuntimeApp.log('info', 'running ' + project.title + ': ' + p.tags.length + ' tags, ' +
		p.devices.length + ' devices, ' + p.settings.width + 'x' + p.settings.height);

	// Device faults go to the log as they change, for diagnosing a target PC
	// remotely
	var last = {};

	ui.hmiRuntime.driver.on('status', function(devices)
	{
		for (var name in devices)
		{
			var d = devices[name];
			var text = d.state + ((d.lastError) ? ' (' + d.lastError + ')' : '');

			if (last[name] !== text)
			{
				last[name] = text;
				HmiRuntimeApp.log((d.state === 'connected') ? 'info' : 'warn',
					'device ' + name + ': ' + text);
			}
		}
	});
};

HmiRuntimeApp.VIEW_LABELS = {fit: 'Fit to window', fill: 'Maximize', original: 'Original size'};

HmiRuntimeApp.viewKey = function()
{
	return 'hmiView/' + ((HmiRuntimeApp.info != null) ? HmiRuntimeApp.info.productName : '');
};

/** The view this browser last chose for the application, else hmiview, else fit. */
HmiRuntimeApp.initialView = function()
{
	var views = HmiWindowManager.VIEWS;

	try
	{
		var saved = window.localStorage.getItem(HmiRuntimeApp.viewKey());

		if (mxUtils.indexOf(views, saved) >= 0)
		{
			return saved;
		}
	}
	catch (e)
	{
		// Storage may be unavailable (private windows)
	}

	return (mxUtils.indexOf(views, urlParams['hmiview']) >= 0) ? urlParams['hmiview'] : 'fit';
};

/**
 * A small button in the top right corner, faint until pointed at, with the
 * view modes and full screen. The choice is remembered by this browser.
 */
HmiRuntimeApp.showViewMenu = function(ui)
{
	var menu = document.createElement('div');
	menu.className = 'hmiViewMenu';

	var button = document.createElement('button');
	button.className = 'hmiViewButton';
	button.setAttribute('title', 'View');
	button.setAttribute('data-hmi-field', 'viewMenu');
	button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" ' +
		'd="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z"/></svg>';
	menu.appendChild(button);

	var list = document.createElement('div');
	list.className = 'hmiViewOptions';
	list.style.display = 'none';
	menu.appendChild(list);

	var items = {};

	var refresh = function()
	{
		for (var key in items)
		{
			items[key].classList.toggle('hmiViewSelected', key === ui.hmiRuntime.view);
		}
	};

	var add = function(key, label, fn)
	{
		var item = document.createElement('button');
		item.className = 'hmiViewOption';
		item.setAttribute('data-hmi-view', key);
		mxUtils.write(item, label);
		mxEvent.addListener(item, 'click', function(evt)
		{
			mxEvent.consume(evt);
			list.style.display = 'none';
			fn();
			refresh();
		});
		list.appendChild(item);
		items[key] = item;
	};

	for (var i = 0; i < HmiWindowManager.VIEWS.length; i++)
	{
		(function(view)
		{
			add(view, HmiRuntimeApp.VIEW_LABELS[view], function()
			{
				if (ui.hmiRuntime != null)
				{
					ui.hmiRuntime.setView(view);
				}

				try
				{
					window.localStorage.setItem(HmiRuntimeApp.viewKey(), view);
				}
				catch (e)
				{
					// Not remembered, still applied
				}
			});
		})(HmiWindowManager.VIEWS[i]);
	}

	if (document.fullscreenEnabled)
	{
		add('fullscreen', 'Full screen', function()
		{
			if (document.fullscreenElement != null)
			{
				document.exitFullscreen();
			}
			else
			{
				document.documentElement.requestFullscreen();
			}
		});

		delete items['fullscreen'];
	}

	mxEvent.addListener(button, 'click', function(evt)
	{
		mxEvent.consume(evt);
		list.style.display = (list.style.display === 'none') ? '' : 'none';
		refresh();
	});

	mxEvent.addListener(document, 'pointerdown', function(evt)
	{
		if (!menu.contains(evt.target))
		{
			list.style.display = 'none';
		}
	});

	document.body.appendChild(menu);
	HmiRuntimeApp.viewMenu = menu;
	refresh();
};

/** A full-window reason instead of a blank screen. */
HmiRuntimeApp.fail = function(message)
{
	HmiRuntimeApp.log('error', message);

	var div = document.createElement('div');
	div.className = 'hmiRuntimeFailure';

	var title = document.createElement('div');
	title.className = 'hmiRuntimeFailureTitle';
	mxUtils.write(title, ((HmiRuntimeApp.info != null) ?
		HmiRuntimeApp.info.productName + ' ' : '') + 'could not start');
	div.appendChild(title);

	var text = document.createElement('div');
	mxUtils.write(text, message);
	div.appendChild(text);

	document.body.appendChild(div);
};

HmiRuntimeApp.promptExit = function(ui)
{
	if (HmiRuntimeApp.exitPrompt != null)
	{
		return;
	}

	var div = HmiDialogs.el('div', 'hmiDialog');
	div.appendChild(HmiDialogs.el('div', 'hmiDialogTitle', 'Exit'));

	var body = HmiDialogs.el('div', 'hmiDialogBody hmiDialogBodyPlain');
	var input = HmiDialogs.field(body, 'Password', '', function() {}, 'password');
	input.setAttribute('data-hmi-field', 'exitPassword');
	input.setAttribute('autocomplete', 'off');
	var error = HmiDialogs.el('div', 'hmiError');
	body.appendChild(error);
	div.appendChild(body);

	var close = function()
	{
		HmiRuntimeApp.exitPrompt = null;
		ui.hideDialog();
	};

	var submit = function()
	{
		HmiRuntimeApp.request('hmiRuntime.exit', {password: input.value}).then(function(ok)
		{
			if (!ok)
			{
				input.value = '';
				error.innerText = 'Wrong password.';
				input.focus();
			}
		})['catch'](function(e)
		{
			error.innerText = e.message;
		});
	};

	mxEvent.addListener(input, 'keydown', function(evt)
	{
		if (evt.keyCode == 13)
		{
			submit();
		}
		else if (evt.keyCode == 27)
		{
			close();
		}
	});

	var footer = HmiDialogs.el('div', 'hmiDialogFooter');
	footer.appendChild(HmiDialogs.el('span', 'hmiSpacer'));
	footer.appendChild(HmiDialogs.button(mxResources.get('cancel'), close));
	footer.appendChild(HmiDialogs.button('Exit', submit, true));
	div.appendChild(footer);

	HmiRuntimeApp.exitPrompt = div;
	ui.showDialog(div, 320, 170, true, false, function()
	{
		HmiRuntimeApp.exitPrompt = null;
	});
	input.focus();
};
