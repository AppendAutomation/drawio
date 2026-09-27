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
