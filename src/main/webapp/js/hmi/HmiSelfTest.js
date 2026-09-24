/**
 * In-app self test.
 *
 * Runs against a live EditorUi so that the assertions exercise the real
 * upstream save path, the real Format rebuild and the real mxCell codec --
 * the things a unit test with a mock would not catch.
 *
 * Enabled with ?hmitest=1 (the desktop shell passes query params through), or
 * by calling HmiSelfTest.run() from the console. Results go to the console
 * prefixed HMITEST so the harness can grep them.
 */
HmiSelfTest = function() {};

HmiSelfTest.results = [];

HmiSelfTest.check = function(name, condition, detail)
{
	HmiSelfTest.results.push({name: name, pass: !!condition, detail: detail});

	console.log('HMITEST ' + ((condition) ? 'PASS' : 'FAIL') + ' ' + name +
		((!condition && detail != null) ? ' :: ' + detail : ''));
};

HmiSelfTest.run = function(ui)
{
	ui = ui || window.App_ui || HmiSelfTest.ui;

	if (ui == null)
	{
		console.log('HMITEST FAIL harness :: no EditorUi');

		return;
	}

	HmiSelfTest.results = [];

	try
	{
		HmiSelfTest.testExpressions();
		HmiSelfTest.testSimulation();
		HmiSelfTest.testProjectRoundTrip();
		HmiSelfTest.testCellLinks(ui);
		HmiSelfTest.testFileRoundTrip(ui);
		HmiSelfTest.testFilenames(ui);
		HmiSelfTest.testFormatTab(ui);
		HmiSelfTest.testRuntime(ui);
		HmiSelfTest.testMenusAndDialogs(ui);
		HmiSelfTest.testPanelLayout(ui);
		HmiSelfTest.testMovement(ui);
		HmiSelfTest.testM2Interaction(ui);
		HmiSelfTest.testDiscreteText(ui);
		HmiSelfTest.testScriptFields(ui);
	}
	catch (e)
	{
		console.log('HMITEST FAIL harness :: ' + e.message + ' @ ' + e.stack);
	}

	// The test edits the graph and the dictionary, which marks the file
	// modified and leaves autosave drafts behind -- so every later launch
	// would open with a draft-recovery prompt. Clear it down.
	if (HmiMenus.isRunning(ui))
	{
		HmiMenus.stop(ui);
	}

	HmiSelfTest.clearDraft(ui);

	var failed = 0;

	for (var i = 0; i < HmiSelfTest.results.length; i++)
	{
		if (!HmiSelfTest.results[i].pass)
		{
			failed++;
		}
	}

	console.log('HMITEST DONE total=' + HmiSelfTest.results.length +
		' failed=' + failed);
};

/**
 * Clears the canvas.
 *
 * The tests share one EditorUi, and setFileData replaces the model wholesale --
 * restoring the cells that were serialised into the test file. The model's id
 * counter starts over with the new root, so a cell inserted afterwards can be
 * handed an id a restored cell already holds. Bindings are keyed by cell id, so
 * two cells then share one binding and a test silently reads another test's
 * configuration. Starting each graph-touching test from an empty canvas is the
 * fix; it also keeps failures readable.
 */
HmiSelfTest.resetGraph = function(ui)
{
	var graph = ui.editor.graph;

	graph.clearSelection();
	graph.getModel().beginUpdate();

	try
	{
		graph.removeCells(graph.getChildCells(graph.getDefaultParent(),
			true, true));
	}
	finally
	{
		graph.getModel().endUpdate();
	}
};

// ------------------------------------------------------------- fixtures

HmiSelfTest.sampleProject = function()
{
	var p = new HmiProject();

	p.accessNames.push({id: 'PLC1', driver: 'simulator', node: '', topic: '',
		rateMs: 250});

	var level = HmiProject.createTag('Tank_Level', 'IOReal');
	level.comment = 'Day tank';
	level.engUnits = '%';
	level.access = 'PLC1';
	level.item = 'N7:0';
	level.alarms = {loLo: 5, low: 10, high: 90, hiHi: 95};
	level.sim = {mode: 'sine', periodMs: '30000'};
	p.addTag(level);

	p.addTag(HmiProject.createTag('Pump1_Run', 'MemoryDiscrete'));
	p.addTag(HmiProject.createTag('Recipe_Name', 'MemoryMessage'));

	return p;
};

// ---------------------------------------------------------------- tests

/** toXml -> fromXml -> toXml must be stable, or golden files are worthless. */
HmiSelfTest.testProjectRoundTrip = function()
{
	var doc = mxUtils.createXmlDocument();
	var p1 = HmiSelfTest.sampleProject();
	var x1 = mxUtils.getXml(p1.toXml(doc));

	var parsed = mxUtils.parseXml(x1);
	var p2 = HmiProject.fromXml(parsed.documentElement);
	var x2 = mxUtils.getXml(p2.toXml(doc));

	HmiSelfTest.check('project.roundTrip.stable', x1 === x2,
		'\n  first=' + x1 + '\n  second=' + x2);
	HmiSelfTest.check('project.roundTrip.tagCount', p2.tags.length === 3,
		'got ' + p2.tags.length);
	HmiSelfTest.check('project.roundTrip.alarms',
		p2.getTag('Tank_Level').alarms != null &&
		p2.getTag('Tank_Level').alarms.hiHi === 95);
	HmiSelfTest.check('project.lookup.caseInsensitive',
		p2.getTag('tank_level') != null);
};

/** Links must survive the mxCell codec untouched, including newlines. */
HmiSelfTest.testCellLinks = function(ui)
{
	var graph = ui.editor.graph;
	var parent = graph.getDefaultParent();
	var cell = null;

	graph.getModel().beginUpdate();

	try
	{
		cell = graph.insertVertex(parent, null, 'SelfTest', 20, 20, 80, 40);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	var links = {
		'fillColor.analog': {expr: 'Tank_Level',
			bands: [{max: 'Tank_Level.MaxEU * 0.9', color: '#00CC00'},
					{max: null, color: '#CC0000'}]},
		'pushbutton': {kind: 'discrete', tag: 'Pump1_Run', action: 'toggle',
			// A multi-line value is the case that flat XML attributes would
			// silently mangle, so it is asserted explicitly.
			enableExpr: 'A == 1;\nB == 2;'}
	};

	HmiProject.setCellLinks(graph, cell, links);

	var back = HmiProject.getCellLinks(graph, cell);

	HmiSelfTest.check('cell.links.expr',
		back['fillColor.analog'].expr === 'Tank_Level');
	HmiSelfTest.check('cell.links.bandExpression',
		back['fillColor.analog'].bands[0].max === 'Tank_Level.MaxEU * 0.9');
	HmiSelfTest.check('cell.links.terminalBandNull',
		back['fillColor.analog'].bands[1].max === null);
	HmiSelfTest.check('cell.links.newlinesPreserved',
		back['pushbutton'].enableExpr === 'A == 1;\nB == 2;',
		JSON.stringify(back['pushbutton'].enableExpr));

	// The cell value must have been promoted to an element node.
	HmiSelfTest.check('cell.links.userObject',
		cell.value != null && typeof cell.value === 'object');

	// Removing every link must remove the attribute, keeping clean cells clean.
	HmiProject.setCellLinks(graph, cell, {});
	HmiSelfTest.check('cell.links.cleared',
		graph.getAttributeForCell(cell, 'hmi', null) == null);

	HmiProject.setCellLinks(graph, cell, links);
	HmiSelfTest.testCell = cell;
};

/**
 * The load-bearing test: does <hmiProject> survive upstream's real save path?
 */
HmiSelfTest.testFileRoundTrip = function(ui)
{
	ui.hmiProject = HmiSelfTest.sampleProject();

	var data = ui.getFileData(true);

	HmiSelfTest.check('file.save.hmiVersion',
		data.indexOf('hmiVersion="1"') > 0);
	HmiSelfTest.check('file.save.hmiProject',
		data.indexOf('<hmiProject') > 0);
	HmiSelfTest.check('file.save.tagPresent',
		data.indexOf('Tank_Level') > 0);
	HmiSelfTest.check('file.save.cellAttribute',
		data.indexOf('hmi=') > 0, 'cell links missing from saved XML');

	// Exactly one dictionary, even after repeated saves.
	var again = ui.getFileData(true);
	var count = again.split('<hmiProject').length - 1;
	HmiSelfTest.check('file.save.singleDictionary', count === 1,
		'found ' + count);

	// And back in.
	ui.hmiProject = null;
	ui.setFileData(again);

	HmiSelfTest.check('file.load.project', ui.hmiProject != null);
	HmiSelfTest.check('file.load.tagCount',
		ui.hmiProject != null && ui.hmiProject.tags.length === 3,
		(ui.hmiProject != null) ? 'got ' + ui.hmiProject.tags.length : 'null');
	HmiSelfTest.check('file.load.ioFields',
		ui.hmiProject != null &&
		ui.hmiProject.getTag('Tank_Level') != null &&
		ui.hmiProject.getTag('Tank_Level').item === 'N7:0');

	// The detector: dictionary stripped but the marker left behind.
	var stripped = again.replace(/<hmiProject[\s\S]*?<\/hmiProject>/, '');
	ui.hmiProject = null;
	ui.setFileData(stripped);
	HmiSelfTest.check('file.load.lossDetected',
		ui.hmiProject != null && ui.hmiProject.isEmpty(),
		'expected an empty project plus a warning');
};

/** Spike 2: four tabs, and routing that does not strand the user. */
HmiSelfTest.testFormatTab = function(ui)
{
	var graph = ui.editor.graph;
	var format = ui.format;

	if (format == null || HmiSelfTest.testCell == null)
	{
		HmiSelfTest.check('format.available', false, 'no format panel');

		return;
	}

	graph.setSelectionCell(HmiSelfTest.testCell);
	format.immediateRefresh();

	var strip = format.container.firstChild;
	var labels = (strip != null) ? strip.childNodes : [];
	var panels = Array.prototype.slice.call(format.container.childNodes, 1);

	HmiSelfTest.check('format.tabCount', labels.length === 4,
		'got ' + labels.length);
	HmiSelfTest.check('format.panelCount', panels.length === 4,
		'got ' + panels.length);
	HmiSelfTest.check('format.animationLast',
		labels.length === 4 &&
		labels[3].getAttribute('title') === mxResources.get('hmiAnimation'));

	if (labels.length !== 4)
	{
		return;
	}

	function visibleCount()
	{
		var n = 0;

		for (var i = 0; i < panels.length; i++)
		{
			if (panels[i].style.display !== 'none')
			{
				n++;
			}
		}

		return n;
	}

	function activeIndex()
	{
		for (var i = 0; i < panels.length; i++)
		{
			if (panels[i].style.display !== 'none')
			{
				return i;
			}
		}

		return -1;
	}

	// Exactly one panel visible at rest.
	HmiSelfTest.check('format.oneVisibleInitially', visibleCount() === 1,
		'got ' + visibleCount());

	// Click every tab, then go back through them. The stale-closure bug shows
	// up as a click that does nothing after the Animation tab has been used.
	var order = [0, 1, 2, 3, 2, 1, 0, 3, 0];
	var ok = true;
	var detail = '';

	for (var i = 0; i < order.length; i++)
	{
		var idx = order[i];
		labels[idx].click();

		if (activeIndex() !== idx || visibleCount() !== 1)
		{
			ok = false;
			detail = 'clicking ' + idx + ' left active=' + activeIndex() +
				' visible=' + visibleCount();
			break;
		}
	}

	HmiSelfTest.check('format.routingStable', ok, detail);

	// The Animation panel must actually render its launcher.
	labels[3].click();
	HmiSelfTest.check('format.animationContent',
		panels[3].getElementsByClassName('hmiChip').length > 0,
		'no link chips rendered');
};

/**
 * Spike 1: the run-mode repaint mechanism.
 *
 * These are the assertions the whole runtime design rests on. In order:
 * does decorating getCellStyle plus a targeted repaint actually recolour a
 * shape; does that survive the revalidation caused by refresh and zoom; and
 * does the whole run leave the model -- and therefore undo and the modified
 * flag -- completely untouched.
 */
HmiSelfTest.testRuntime = function(ui)
{
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);
	var model = graph.getModel();
	var project = HmiSelfTest.sampleProject();
	ui.hmiProject = project;

	// Two cells: one analog fill colour, one visibility + pushbutton.
	var tank = null;
	var lamp = null;

	model.beginUpdate();

	try
	{
		tank = graph.insertVertex(graph.getDefaultParent(), null, 'Tank',
			300, 40, 80, 60);
		lamp = graph.insertVertex(graph.getDefaultParent(), null, 'Lamp',
			420, 40, 60, 40);
	}
	finally
	{
		model.endUpdate();
	}

	HmiProject.setCellLinks(graph, tank, {
		'fillColor.analog': {expr: 'Tank_Level', bands: [
			{max: '50', color: '#00CC00'},
			{max: null, color: '#CC0000'}]}
	});

	HmiProject.setCellLinks(graph, lamp, {
		'visibility': {expr: 'Pump1_Run', sense: 'visible'},
		'pushbutton': {kind: 'discrete', tag: 'Pump1_Run', action: 'toggle'}
	});

	// Deliberately no label, to prove Value Display creates one.
	var readout = null;

	model.beginUpdate();

	try
	{
		readout = graph.insertVertex(graph.getDefaultParent(), null, '',
			300, 140, 90, 30);
	}
	finally
	{
		model.endUpdate();
	}

	HmiProject.setCellLinks(graph, readout, {
		'valueDisplay': {kind: 'analog', expr: 'Tank_Level', format: '0.0',
			prefix: '', suffix: ' %'}
	});

	var designFill = graph.getCellStyle(tank)[mxConstants.STYLE_FILLCOLOR];

	// Watch the model for the whole run. Any change at all is a design
	// violation, not a tuning issue.
	var modelChanges = 0;
	var watcher = function() { modelChanges++; };
	model.addListener(mxEvent.CHANGE, watcher);

	var undoBefore = (ui.editor.undoManager != null) ?
		ui.editor.undoManager.history.length : -1;
	var modifiedBefore = ui.editor.modified;

	var sim = new HmiSimulator(project);
	var rt = new HmiRuntime({graph: graph, project: project, driver: sim});
	HmiSelfTest.runtime = rt;

	rt.start();

	// Drive a known value rather than waiting for the simulator's waveform.
	function setLevel(v)
	{
		rt.applyBatch({'Tank_Level': {value: v,
			quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()}});
		rt.flush();
	}

	setLevel(10);

	var state = graph.view.getState(tank);

	HmiSelfTest.check('runtime.state', state != null && state.shape != null);

	if (state == null || state.shape == null)
	{
		model.removeListener(watcher);
		rt.stop();

		return;
	}

	HmiSelfTest.check('runtime.recolour.low',
		state.style[mxConstants.STYLE_FILLCOLOR] === '#00CC00',
		'style fill = ' + state.style[mxConstants.STYLE_FILLCOLOR]);

	// The shape object must actually carry it, not just the style map --
	// this is what proves configureShape ran rather than the mutation being
	// swallowed by mxShape.apply's aliasing.
	HmiSelfTest.check('runtime.recolour.shape',
		state.shape.fill === '#00CC00', 'shape.fill = ' + state.shape.fill);

	setLevel(80);

	HmiSelfTest.check('runtime.recolour.high',
		state.shape.fill === '#CC0000', 'shape.fill = ' + state.shape.fill);

	// Crossing back must also repaint (the visual diff must not latch).
	setLevel(10);
	HmiSelfTest.check('runtime.recolour.backDown',
		state.shape.fill === '#00CC00', 'shape.fill = ' + state.shape.fill);

	// --- revalidation survival -------------------------------------------
	// validateCellState reassigns state.style = graph.getCellStyle(cell), so
	// a decorator that was not idempotent would lose the colour here.

	setLevel(80);
	graph.refresh();
	state = graph.view.getState(tank);

	HmiSelfTest.check('runtime.survivesRefresh',
		state != null && state.shape != null && state.shape.fill === '#CC0000',
		'shape.fill = ' + ((state != null && state.shape != null) ?
			state.shape.fill : 'no state'));

	var zoom = graph.view.scale;
	graph.zoomIn();
	state = graph.view.getState(tank);

	HmiSelfTest.check('runtime.survivesZoom',
		state != null && state.shape != null && state.shape.fill === '#CC0000',
		'shape.fill = ' + ((state != null && state.shape != null) ?
			state.shape.fill : 'no state'));

	graph.zoomOut();

	// --- visibility -------------------------------------------------------

	rt.applyBatch({'Pump1_Run': {value: 0, quality: HmiTypes.QUALITY_GOOD,
		timestamp: Date.now()}});
	rt.flush();

	var lampState = graph.view.getState(lamp);

	HmiSelfTest.check('runtime.visibility.hidden',
		lampState != null && lampState.shape != null &&
		lampState.shape.node.style.visibility === 'hidden',
		'visibility = ' + ((lampState != null && lampState.shape != null) ?
			lampState.shape.node.style.visibility : 'no state'));

	rt.applyBatch({'Pump1_Run': {value: 1, quality: HmiTypes.QUALITY_GOOD,
		timestamp: Date.now()}});
	rt.flush();

	HmiSelfTest.check('runtime.visibility.shown',
		lampState.shape.node.style.visibility !== 'hidden');

	// Visibility must survive revalidation the same way colour does. The diff
	// correctly suppresses a repaint when the visual has not changed, so if
	// visibility were only applied in repaint() a refresh or zoom would
	// silently bring a hidden object back.
	rt.applyBatch({'Pump1_Run': {value: 0, quality: HmiTypes.QUALITY_GOOD,
		timestamp: Date.now()}});
	rt.flush();
	graph.refresh();
	lampState = graph.view.getState(lamp);

	HmiSelfTest.check('runtime.visibility.survivesRefresh',
		lampState != null && lampState.shape != null &&
		lampState.shape.node.style.visibility === 'hidden',
		'visibility = ' + ((lampState != null && lampState.shape != null) ?
			lampState.shape.node.style.visibility : 'no state'));

	graph.zoomIn();
	lampState = graph.view.getState(lamp);

	HmiSelfTest.check('runtime.visibility.survivesZoom',
		lampState != null && lampState.shape != null &&
		lampState.shape.node.style.visibility === 'hidden',
		'visibility = ' + ((lampState != null && lampState.shape != null) ?
			lampState.shape.node.style.visibility : 'no state'));

	graph.zoomOut();

	// A hidden object must not respond to touch.
	var beforeTouch = sim.get('Pump1_Run').value;
	rt.handleTouch(lamp, 'click');

	HmiSelfTest.check('runtime.visibility.blocksTouch',
		sim.get('Pump1_Run').value === beforeTouch,
		'hidden object accepted a click');

	rt.applyBatch({'Pump1_Run': {value: 1, quality: HmiTypes.QUALITY_GOOD,
		timestamp: Date.now()}});
	rt.flush();

	// --- pushbutton -------------------------------------------------------

	rt.handleTouch(lamp, 'click');

	HmiSelfTest.check('runtime.pushbutton.writes',
		sim.get('Pump1_Run').value === 0,
		'value = ' + sim.get('Pump1_Run').value);

	rt.handleTouch(lamp, 'click');

	HmiSelfTest.check('runtime.pushbutton.toggles',
		sim.get('Pump1_Run').value === 1,
		'value = ' + sim.get('Pump1_Run').value);

	// --- bad quality ------------------------------------------------------

	rt.applyBatch({'Tank_Level': {value: 80,
		quality: HmiTypes.QUALITY_BAD, timestamp: Date.now()}});
	rt.flush();
	state = graph.view.getState(tank);

	HmiSelfTest.check('runtime.badQuality.holdsLast',
		state.shape.fill === '#CC0000',
		'expected the last good colour, got ' + state.shape.fill);

	// --- value display ----------------------------------------------------

	// A shape drawn without a label has no text shape, so a Value Display on
	// it used to render nothing at all. The cell itself was created before the
	// model watcher was armed, since creating it is an edit like any other.
	rt.bind();
	rt.applyBatch({'Tank_Level': {value: 42.67,
		quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()}});
	rt.flush();

	var readoutState = graph.view.getState(readout);

	HmiSelfTest.check('runtime.valueDisplay.createsLabel',
		readoutState != null && readoutState.text != null,
		'no text shape was created for an unlabelled cell');
	HmiSelfTest.check('runtime.valueDisplay.showsValue',
		readoutState != null && readoutState.text != null &&
		('' + readoutState.text.value).indexOf('42.7') >= 0,
		'label = ' + ((readoutState != null && readoutState.text != null) ?
			readoutState.text.value : 'none'));

	HmiSelfTest.check('runtime.format.decimals',
		HmiRuntime.formatNumber(42.667, '0.0') === '42.7',
		HmiRuntime.formatNumber(42.667, '0.0'));
	HmiSelfTest.check('runtime.format.leadingZeros',
		HmiRuntime.formatNumber(7, '000') === '007',
		HmiRuntime.formatNumber(7, '000'));

	// --- the invariant ----------------------------------------------------

	HmiSelfTest.check('runtime.modelUntouched', modelChanges === 0,
		modelChanges + ' model changes during run');

	rt.stop();

	HmiSelfTest.check('runtime.modelUntouchedAfterStop', modelChanges === 0,
		modelChanges + ' model changes including stop');

	var undoAfter = (ui.editor.undoManager != null) ?
		ui.editor.undoManager.history.length : -1;

	HmiSelfTest.check('runtime.undoUntouched', undoAfter === undoBefore,
		'history ' + undoBefore + ' -> ' + undoAfter);
	HmiSelfTest.check('runtime.modifiedFlagUntouched',
		ui.editor.modified === modifiedBefore,
		'modified ' + modifiedBefore + ' -> ' + ui.editor.modified);

	model.removeListener(watcher);

	// --- restored on stop -------------------------------------------------

	state = graph.view.getState(tank);

	HmiSelfTest.check('runtime.restoresDesignColour',
		state == null || state.shape == null ||
		state.shape.fill === designFill,
		'design ' + designFill + ', got ' +
		((state != null && state.shape != null) ? state.shape.fill : 'none'));

	HmiSelfTest.check('runtime.reenablesEditing', graph.isEnabled());
};

/** Menu, actions, Run/Stop lifecycle and the tag dictionary. */
HmiSelfTest.testMenusAndDialogs = function(ui)
{
	// --- registration -----------------------------------------------------

	HmiSelfTest.check('menu.registered',
		ui.menus != null && ui.menus.menus['hmi'] != null);
	HmiSelfTest.check('menu.inMenubar',
		mxUtils.indexOf(Menus.prototype.defaultMenuItems, 'hmi') >= 0,
		Menus.prototype.defaultMenuItems.join(','));

	var actions = ['hmiTagDictionary', 'hmiAccessNames', 'hmiValidate',
		'hmiRun', 'hmiStop', 'hmiRuntimeLog'];
	var missing = [];

	for (var i = 0; i < actions.length; i++)
	{
		if (ui.actions.get(actions[i]) == null)
		{
			missing.push(actions[i]);
		}
	}

	HmiSelfTest.check('menu.actions', missing.length === 0,
		'missing ' + missing.join(','));

	// Asserting the actions exist is NOT enough, and an earlier version of
	// this test proved it: addAction strips a trailing '...' before storing
	// while addMenuItem looks the key up verbatim, so the menu silently
	// rendered nothing while every action resolved. Build the menu for real.
	var rendered = [];

	try
	{
		var fake = {
			showDisabled: true,
			hideShortcuts: true,
			addItem: function(label)
			{
				rendered.push(label);

				return document.createElement('div');
			},
			addSeparator: function() { rendered.push('-'); },
			addCheckmark: function() {}
		};

		ui.menus.menus['hmi'].funct(fake, null);
	}
	catch (e)
	{
		rendered = ['threw: ' + e.message];
	}

	var items = [];

	for (var i = 0; i < rendered.length; i++)
	{
		if (rendered[i] !== '-')
		{
			items.push(rendered[i]);
		}
	}

	HmiSelfTest.check('menu.rendersItems', items.length >= 5,
		'rendered [' + rendered.join(', ') + ']');
	// The rendered title carries the trailing '...' from the action key.
	var hasDictionary = false;

	for (var i = 0; i < items.length; i++)
	{
		if (('' + items[i]).indexOf(mxResources.get('hmiTagDictionary')) === 0)
		{
			hasDictionary = true;
		}
	}

	HmiSelfTest.check('menu.hasTagDictionary', hasDictionary,
		'rendered [' + items.join(', ') + ']');

	// --- tag dictionary ---------------------------------------------------

	ui.hmiProject = HmiSelfTest.sampleProject();

	var dlg = new HmiTagDialog(ui);
	dlg.init();

	HmiSelfTest.check('tagDialog.listsTags',
		dlg.listDiv.getElementsByClassName('hmiTagRow').length === 3,
		'rows = ' + dlg.listDiv.getElementsByClassName('hmiTagRow').length);

	dlg.filter.value = 'pump';
	dlg.renderList();

	HmiSelfTest.check('tagDialog.filters',
		dlg.listDiv.getElementsByClassName('hmiTagRow').length === 1);

	dlg.filter.value = '';
	dlg.renderList();

	dlg.createTag('MemoryReal');

	HmiSelfTest.check('tagDialog.createsTag',
		ui.hmiProject.tags.length === 4 && dlg.selected != null);

	dlg.remove();

	HmiSelfTest.check('tagDialog.deletesTag',
		ui.hmiProject.tags.length === 3);

	// --- CSV --------------------------------------------------------------

	var added = dlg.applyCsv(
		'name,type,comment,minEU,maxEU\n' +
		'CSV_Flow,IOReal,"Header, quoted",0,500\n' +
		'CSV_Run,MemoryDiscrete,,,\n');

	HmiSelfTest.check('tagDialog.csvImport', added === 2,
		'added ' + added);
	HmiSelfTest.check('tagDialog.csvQuotedComma',
		ui.hmiProject.getTag('CSV_Flow') != null &&
		ui.hmiProject.getTag('CSV_Flow').comment === 'Header, quoted',
		(ui.hmiProject.getTag('CSV_Flow') != null) ?
			ui.hmiProject.getTag('CSV_Flow').comment : 'missing');
	HmiSelfTest.check('tagDialog.csvNumeric',
		ui.hmiProject.getTag('CSV_Flow').maxEU === 500);

	// --- rename rewrites references --------------------------------------
	// A rename that does not carry its references breaks every animation
	// using the tag, so this is asserted rather than assumed.

	var graph = ui.editor.graph;
	var cell = null;

	graph.getModel().beginUpdate();

	try
	{
		cell = graph.insertVertex(graph.getDefaultParent(), null, 'Rename',
			560, 40, 60, 40);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	HmiProject.setCellLinks(graph, cell, {
		'fillColor.analog': {expr: 'Tank_Level', bands: [
			{max: 'Tank_Level.MaxEU * 0.9', color: '#00CC00'},
			{max: null, color: '#CC0000'}]},
		'visibility': {expr: 'NOT Tank_LevelOther', sense: 'visible'}
	});

	var refs = HmiTagDialog.findReferences(ui, 'Tank_Level');

	HmiSelfTest.check('tagDialog.findsReferences', refs.length >= 2,
		'found ' + refs.length);

	dlg.selected = ui.hmiProject.getTag('Tank_Level');
	dlg.rename(dlg.selected, 'DayTank_Level');

	var after = HmiProject.getCellLinks(graph, cell);

	HmiSelfTest.check('tagDialog.renameRewritesExpr',
		after['fillColor.analog'].expr === 'DayTank_Level',
		after['fillColor.analog'].expr);
	HmiSelfTest.check('tagDialog.renameRewritesDotfield',
		after['fillColor.analog'].bands[0].max === 'DayTank_Level.MaxEU * 0.9',
		after['fillColor.analog'].bands[0].max);

	// A longer name that merely starts with the old one must be left alone.
	HmiSelfTest.check('tagDialog.renameRespectsWordBoundary',
		after['visibility'].expr === 'NOT Tank_LevelOther',
		after['visibility'].expr);
	HmiSelfTest.check('tagDialog.renameUpdatesIndex',
		ui.hmiProject.getTag('DayTank_Level') != null &&
		ui.hmiProject.getTag('Tank_Level') == null);

	// --- colour link mutual exclusion ------------------------------------
	// Discrete and Analog both drive the same visual property, so holding both
	// would make the outcome depend on evaluation order rather than intent.

	graph.setSelectionCell(cell);
	ui.format.immediateRefresh();

	var panel = null;

	for (var i = 0; i < ui.format.panels.length; i++)
	{
		if (ui.format.panels[i] instanceof HmiFormatPanel)
		{
			panel = ui.format.panels[i];
		}
	}

	if (panel != null && panel.links != null)
	{
		panel.addLink(HmiTypes.LINKS['fillColor.discrete']);
		var nowLinks = HmiProject.getCellLinks(graph, cell);

		HmiSelfTest.check('panel.colourExclusion.replaces',
			nowLinks['fillColor.discrete'] != null &&
			nowLinks['fillColor.analog'] == null,
			Object.keys(nowLinks).join(','));

		// A different attribute is untouched: line and fill coexist happily.
		panel.addLink(HmiTypes.LINKS['lineColor.analog']);
		nowLinks = HmiProject.getCellLinks(graph, cell);

		HmiSelfTest.check('panel.colourExclusion.perAttribute',
			nowLinks['fillColor.discrete'] != null &&
			nowLinks['lineColor.analog'] != null,
			Object.keys(nowLinks).join(','));
	}
	else
	{
		HmiSelfTest.check('panel.colourExclusion.available', false,
			'no HmiFormatPanel in the format panels');
	}

	// --- run / stop -------------------------------------------------------

	ui.hmiProject = HmiSelfTest.sampleProject();

	var modifiedBeforeRun = ui.editor.modified;

	HmiMenus.start(ui);

	HmiSelfTest.check('run.starts', HmiMenus.isRunning(ui));
	HmiSelfTest.check('run.disablesEditing', !graph.isEnabled());
	HmiSelfTest.check('run.showsBanner',
		document.getElementsByClassName('hmiBanner').length === 1);
	HmiSelfTest.check('run.marksContainer',
		ui.container.classList.contains('hmiRunning'));

	HmiMenus.stop(ui);

	HmiSelfTest.check('run.stops', !HmiMenus.isRunning(ui));
	HmiSelfTest.check('run.reenablesEditing', graph.isEnabled());
	HmiSelfTest.check('run.removesBanner',
		document.getElementsByClassName('hmiBanner').length === 0);
	HmiSelfTest.check('run.clearsContainer',
		!ui.container.classList.contains('hmiRunning'));

	// Running and stopping must not by itself make the file look edited.
	HmiSelfTest.check('run.doesNotMarkModified',
		ui.editor.modified === modifiedBeforeRun,
		'modified ' + modifiedBeforeRun + ' -> ' + ui.editor.modified);

	// Starting twice must not stack runtimes or listeners.
	HmiMenus.start(ui);
	HmiMenus.start(ui);
	HmiSelfTest.check('run.idempotentStart', HmiMenus.isRunning(ui));
	HmiMenus.stop(ui);
	HmiMenus.stop(ui);
	HmiSelfTest.check('run.idempotentStop', !HmiMenus.isRunning(ui) &&
		document.getElementsByClassName('hmiBanner').length === 0);

	// --- validation -------------------------------------------------------

	var problems = HmiMenus.checkLink(ui.hmiProject,
		{expr: 'NoSuchTag', tag: 'AlsoMissing'});

	HmiSelfTest.check('validate.reportsUnknownTags', problems.length === 2,
		problems.join(' | '));

	var clean = HmiMenus.checkLink(ui.hmiProject, {expr: 'Tank_Level'});

	HmiSelfTest.check('validate.acceptsKnownTags', clean.length === 0,
		clean.join(' | '));
};

/**
 * Sets up a cell carrying every milestone-1 link and opens the Animation tab
 * on it. Used to eyeball the panel layout, which assertions cannot judge.
 */
HmiSelfTest.demo = function(ui)
{
	var graph = ui.editor.graph;
	ui.hmiProject = HmiSelfTest.sampleProject();

	var cell = null;

	graph.getModel().beginUpdate();

	try
	{
		cell = graph.insertVertex(graph.getDefaultParent(), null, 'Demo',
			80, 200, 120, 60);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	HmiProject.setCellLinks(graph, cell, {
		'fillColor.analog': HmiTypes.LINKS['fillColor.analog'].defaults(),
		'visibility': HmiTypes.LINKS['visibility'].defaults(),
		'blink': HmiTypes.LINKS['blink'].defaults(),
		'valueDisplay': HmiTypes.LINKS['valueDisplay'].defaults(),
		'userInput': HmiTypes.LINKS['userInput'].defaults(),
		'pushbutton': HmiTypes.LINKS['pushbutton'].defaults()
	});

	// Expand every section so the layout is visible all at once.
	ui.hmiUiState = {expanded: {}};

	for (var key in HmiTypes.LINKS)
	{
		ui.hmiUiState.expanded[key] = true;
	}

	ui.format.collapsedSections = {};

	graph.setSelectionCell(cell);
	ui.format.immediateRefresh();

	// Select the Animation tab.
	var strip = ui.format.container.firstChild;

	if (strip != null && strip.childNodes.length === 4)
	{
		strip.childNodes[3].click();
	}

	HmiSelfTest.clearDraft(ui);
};

/**
 * Drops the modified flag and any autosave draft, so a test or demo run does
 * not leave a draft-recovery prompt for the next launch.
 */
HmiSelfTest.clearDraft = function(ui)
{
	try
	{
		ui.editor.setModified(false);

		var file = ui.getCurrentFile();

		if (file != null)
		{
			file.setModified(false);

			if (file.clearDraft != null)
			{
				file.clearDraft();
			}
		}
	}
	catch (e)
	{
		console.log('HMITEST cleanup :: ' + e.message);
	}
};

/**
 * Layout regression test for the Animation panel.
 *
 * drawio absolutely positions every select inside a .geFormatSection, because
 * its own panels place them at explicit coordinates. Ours are in normal flow,
 * so without an override a select is lifted out of the flow and lands on top
 * of the row after it. That is invisible to any assertion about values, so it
 * is measured here instead.
 */
HmiSelfTest.testPanelLayout = function(ui)
{
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);

	// The placeholder assertion below needs a dictionary to collide with.
	ui.hmiProject = HmiSelfTest.sampleProject();
	var cell = null;

	graph.getModel().beginUpdate();

	try
	{
		cell = graph.insertVertex(graph.getDefaultParent(), null, 'Layout',
			80, 320, 120, 60);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	// Every link type that contains a select, which is where overlap happens.
	HmiProject.setCellLinks(graph, cell, {
		'visibility': HmiTypes.LINKS['visibility'].defaults(),
		'blink': HmiTypes.LINKS['blink'].defaults(),
		'valueDisplay': HmiTypes.LINKS['valueDisplay'].defaults(),
		'userInput': HmiTypes.LINKS['userInput'].defaults(),
		'pushbutton': HmiTypes.LINKS['pushbutton'].defaults()
	});

	ui.hmiUiState = {expanded: {}};

	for (var key in HmiTypes.LINKS)
	{
		ui.hmiUiState.expanded[key] = true;
	}

	ui.format.collapsedSections = {};
	graph.setSelectionCell(cell);
	ui.format.immediateRefresh();

	var strip = ui.format.container.firstChild;

	if (strip == null || strip.childNodes.length !== 4)
	{
		HmiSelfTest.check('layout.animationTab', false, 'no Animation tab');

		return;
	}

	strip.childNodes[3].click();

	var panel = ui.format.container.childNodes[4];

	HmiSelfTest.check('layout.panelVisible',
		panel != null && panel.offsetHeight > 0,
		'panel height = ' + ((panel != null) ? panel.offsetHeight : 'none'));

	if (panel == null || panel.offsetHeight === 0)
	{
		return;
	}

	// No select may be absolutely positioned.
	var selects = panel.getElementsByTagName('select');
	var absolute = [];

	for (var i = 0; i < selects.length; i++)
	{
		if (window.getComputedStyle(selects[i]).position === 'absolute')
		{
			absolute.push(i);
		}
	}

	HmiSelfTest.check('layout.selectsInFlow', absolute.length === 0,
		absolute.length + ' of ' + selects.length + ' selects are absolute');

	// No two CONTROLS may overlap. Comparing row boxes is not enough: an
	// absolutely positioned select escapes its row entirely, so the rows stay
	// tidy while the select sits on top of the next one. Measuring the
	// controls is what actually reproduces what the eye sees.
	var sections = panel.getElementsByClassName('geCollapsibleContent');
	var overlaps = [];

	for (var s = 0; s < sections.length; s++)
	{
		var controls = [];
		var tags = ['input', 'select', 'textarea'];

		for (var t = 0; t < tags.length; t++)
		{
			var found = sections[s].getElementsByTagName(tags[t]);

			for (var f = 0; f < found.length; f++)
			{
				if (found[f].type !== 'checkbox')
				{
					controls.push(found[f]);
				}
			}
		}

		var boxes = [];

		for (var r = 0; r < controls.length; r++)
		{
			var box = controls[r].getBoundingClientRect();

			if (box.height > 0 && box.width > 0)
			{
				boxes.push({top: box.top, bottom: box.bottom,
					left: box.left, right: box.right,
					text: controls[r].tagName.toLowerCase() + '@' +
						Math.round(box.top)});
			}
		}

		for (var a = 0; a < boxes.length; a++)
		{
			for (var b = a + 1; b < boxes.length; b++)
			{
				// Allow a pixel of rounding slack.
				if (boxes[a].top < boxes[b].bottom - 1 &&
					boxes[b].top < boxes[a].bottom - 1 &&
					boxes[a].left < boxes[b].right - 1 &&
					boxes[b].left < boxes[a].right - 1)
				{
					overlaps.push(boxes[a].text + ' / ' + boxes[b].text);
				}
			}
		}
	}

	HmiSelfTest.check('layout.noOverlappingControls', overlaps.length === 0,
		overlaps.join(' | '));

	// The three blink colour swatches must share a left edge.
	var swatches = panel.getElementsByClassName('hmiColor');
	var lefts = {};

	for (var i = 0; i < swatches.length; i++)
	{
		var parent = swatches[i].parentNode;

		if (parent != null && parent.className.indexOf('hmiRowInline') >= 0)
		{
			lefts[Math.round(swatches[i].getBoundingClientRect().left)] = true;
		}
	}

	// A placeholder must never read as a value. The original hints were real
	// tag names, so a field showing "Tank_Level" looked filled in when it was
	// empty -- and the user had a tag by that name, which made it convincing.
	var inputs = panel.getElementsByTagName('input');
	var looksReal = [];

	for (var i = 0; i < inputs.length; i++)
	{
		var hint = inputs[i].getAttribute('placeholder');

		if (hint == null || hint === '')
		{
			continue;
		}

		if (ui.hmiProject != null && ui.hmiProject.getTag(hint) != null)
		{
			looksReal.push(hint);
		}
	}

	HmiSelfTest.check('layout.placeholdersAreNotValues',
		looksReal.length === 0,
		'placeholders naming real tags: ' + looksReal.join(', '));

	HmiSelfTest.check('layout.blinkSwatchesAligned',
		Object.keys(lefts).length <= 1,
		'left edges at ' + Object.keys(lefts).join(', '));

	ui.editor.setModified(false);
};

/**
 * End-to-end run-mode test driven the way a person drives it.
 *
 * The synchronous tests call handleTouch and flush() directly, which proves the
 * logic but skips the two things that actually carry it in use: real mouse
 * events reaching the graph, and the requestAnimationFrame flush. Both are
 * exercised here, on real elapsed time.
 *
 * Asynchronous, so it reports separately from the main suite.
 */
HmiSelfTest.runLive = function(ui)
{
	ui = ui || HmiSelfTest.ui;

	var graph = ui.editor.graph;
	var project = new HmiProject();
	project.accessNames.push({id: 'PLC1', driver: 'simulator', node: '',
		topic: '', rateMs: 100});

	var level = HmiProject.createTag('Tank_Level', 'IOReal');
	level.minEU = 0;
	level.maxEU = 100;
	level.sim = {mode: 'ramp', periodMs: '4000'};
	project.addTag(level);
	project.addTag(HmiProject.createTag('Pump1_Run', 'MemoryDiscrete'));

	ui.hmiProject = project;

	// Clear the canvas so hit-testing cannot land on leftovers.
	HmiSelfTest.resetGraph(ui);

	var readout = null;
	var button = null;

	graph.getModel().beginUpdate();

	try
	{
		readout = graph.insertVertex(graph.getDefaultParent(), null, '',
			80, 80, 140, 50);
		button = graph.insertVertex(graph.getDefaultParent(), null, 'PB',
			80, 200, 140, 50);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	HmiProject.setCellLinks(graph, readout, {
		'valueDisplay': {kind: 'analog', expr: 'Tank_Level', format: '0.0',
			prefix: '', suffix: ' %'}
	});

	// A band boundary that is an expression over the dictionary, which is the
	// whole reason for having an engine rather than literal thresholds.
	var tank = null;

	graph.getModel().beginUpdate();

	try
	{
		tank = graph.insertVertex(graph.getDefaultParent(), null, '',
			260, 80, 120, 60);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	HmiProject.setCellLinks(graph, tank, {
		'fillColor.analog': {expr: 'Tank_Level', bands: [
			{max: 'Tank_Level.MaxEU * 0.9', color: '#00CC00'},
			{max: null, color: '#CC0000'}]}
	});

	HmiProject.setCellLinks(graph, button, {
		'pushbutton': {kind: 'discrete', tag: 'Pump1_Run', action: 'toggle'}
	});

	var entry = null;

	graph.getModel().beginUpdate();

	try
	{
		entry = graph.insertVertex(graph.getDefaultParent(), null, 'SP',
			80, 320, 140, 50);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	HmiProject.setCellLinks(graph, entry, {
		'userInput': {kind: 'analog', tag: 'Tank_Level', min: '0',
			max: 'Tank_Level.MaxEU', prompt: 'Setpoint', keypad: false}
	});

	graph.clearSelection();
	HmiMenus.start(ui);

	HmiSelfTest.check('live.started', HmiMenus.isRunning(ui));

	// Let the simulator scan and the animation frames run for real.
	window.setTimeout(function()
	{
		var rt = ui.hmiRuntime;

		HmiSelfTest.check('live.driverProducedValues',
			rt != null && rt.getValue('Tank_Level').value != null,
			'value = ' + ((rt != null) ?
				rt.getValue('Tank_Level').value : 'no runtime'));

		HmiSelfTest.check('live.repaintsHappened',
			rt != null && rt.repaintCount > 0,
			'repaintCount = ' + ((rt != null) ? rt.repaintCount : 'n/a'));

		var state = graph.view.getState(readout);
		var label = (state != null && state.text != null) ?
			('' + state.text.value) : null;

		HmiSelfTest.check('live.valueDisplayRenders',
			label != null && /\d/.test(label) && label.indexOf('%') >= 0,
			'label = ' + label);

		// Tank_Level.MaxEU * 0.9 is 90, so 50 is under the band and 95 over.
		rt.applyBatch({'Tank_Level': {value: 50,
			quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()}});
		rt.flush();

		var tankState = graph.view.getState(tank);

		HmiSelfTest.check('live.expressionBandUnder',
			tankState != null && tankState.shape != null &&
			tankState.shape.fill === '#00CC00',
			'fill = ' + ((tankState != null && tankState.shape != null) ?
				tankState.shape.fill : 'none'));

		rt.applyBatch({'Tank_Level': {value: 95,
			quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()}});
		rt.flush();

		HmiSelfTest.check('live.expressionBandOver',
			tankState.shape.fill === '#CC0000',
			'fill = ' + tankState.shape.fill);

		// Changing MaxEU in the dictionary must move the threshold, which only
		// works if the compile cache is keyed on the dictionary revision.
		project.getTag('Tank_Level').maxEU = 200;
		project.touch();
		rt.applyBatch({'Tank_Level': {value: 95,
			quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()}});
		rt.flush();

		HmiSelfTest.check('live.thresholdFollowsDictionary',
			tankState.shape.fill === '#00CC00',
			'after MaxEU 100 -> 200 the threshold should be 180; fill = ' +
			tankState.shape.fill);

		project.getTag('Tank_Level').maxEU = 100;
		project.touch();

		// --- touch path -----------------------------------------------------

		var touches = [];
		var origTouch = rt.handleTouch;

		rt.handleTouch = function(cell, phase)
		{
			touches.push(phase + ':' + ((cell != null) ? cell.id : 'null'));

			return origTouch.apply(this, arguments);
		};

		// A tag that never changes must still be known: the driver sends a
		// snapshot when a subscription opens, otherwise the runtime's cache
		// holds null for it and every link reading it looks dead.
		HmiSelfTest.check('live.initialValueKnown',
			rt.getValue('Pump1_Run').value != null,
			'Pump1_Run = ' + rt.getValue('Pump1_Run').value);

		// The real thing, through the DOM.
		var beforeDom = rt.getValue('Pump1_Run').value;
		var domTouchesBefore = touches.length;
		HmiSelfTest.clickCell(graph, button);
		var before = beforeDom;

		HmiSelfTest.check('live.domClickReachesGraph',
			touches.length > domTouchesBefore,
			'a real mouse sequence produced no touch; touches so far [' +
			touches.join(', ') + ']');

		// One gesture must produce exactly one click phase. Two would toggle
		// twice and land back where it started, which reads as "nothing
		// happened" rather than as a bug.
		var clickPhases = 0;

		for (var i = domTouchesBefore; i < touches.length; i++)
		{
			if (touches[i].indexOf('click:') === 0) { clickPhases++; }
		}

		HmiSelfTest.check('live.oneClickPerGesture', clickPhases === 1,
			clickPhases + ' click phases from one gesture [' +
			touches.slice(domTouchesBefore).join(', ') + ']');

		window.setTimeout(function()
		{
			var after = rt.getValue('Pump1_Run').value;

			HmiSelfTest.check('live.pushbuttonToggles', after !== before,
				'Pump1_Run ' + before + ' -> ' + after);

			// User Input: a click must reach the handler the menu injected,
			// with the link config, rather than opening nothing at all.
			var prompted = null;
			rt.onUserInput = function(cfg) { prompted = cfg; };
			HmiSelfTest.clickCell(graph, entry);

			HmiSelfTest.check('live.userInputPrompts',
				prompted != null && prompted.tag === 'Tank_Level',
				'handler got ' + JSON.stringify(prompted));

			// Its limits are expressions, evaluated against the dictionary.
			var limit = (prompted != null) ?
				rt.evaluate(prompted.max) : {value: null};

			HmiSelfTest.check('live.userInputLimitIsExpression',
				parseFloat(limit.value) === 100,
				'max evaluated to ' + limit.value);

			// And a write through the driver reaches the runtime's cache.
			rt.driver.write({'Tank_Level': 42});

			HmiSelfTest.check('live.userInputWriteApplies',
				parseFloat(rt.getValue('Tank_Level').value) === 42,
				'Tank_Level = ' + rt.getValue('Tank_Level').value);

			HmiMenus.stop(ui);
			HmiSelfTest.clearDraft(ui);

			var failed = 0;

			for (var i = 0; i < HmiSelfTest.results.length; i++)
			{
				if (!HmiSelfTest.results[i].pass) { failed++; }
			}

			console.log('HMILIVE DONE total=' + HmiSelfTest.results.length +
				' failed=' + failed);
		}, 400);
	}, 1200);
};

/**
 * Dispatches a real pointer/mouse sequence at the centre of a cell, going
 * through the graph container exactly as a person's click does.
 */
HmiSelfTest.clickCell = function(graph, cell)
{
	var state = graph.view.getState(cell);

	if (state == null)
	{
		HmiSelfTest.check('live.clickTarget', false, 'no state for cell');

		return;
	}

	var container = graph.container;
	var box = container.getBoundingClientRect();
	var x = box.left + state.x + state.width / 2 - container.scrollLeft;
	var y = box.top + state.y + state.height / 2 - container.scrollTop;

	var target = document.elementFromPoint(x, y) || container;

	HmiSelfTest.check('live.clickTargetInCanvas',
		container.contains(target) || target === container,
		'elementFromPoint gave ' + ((target != null) ? target.nodeName : 'null'));

	// Dispatch ONE event family. A browser correlates its own pointer and
	// mouse events so mxGraph sees a single gesture; two hand-made families
	// are uncorrelated and arrive as two gestures, which double-fires the
	// click and makes a toggle look like it did nothing.
	var usePointer = (window.PointerEvent != null);
	var phases = ['down', 'up'];

	for (var i = 0; i < phases.length; i++)
	{
		var opts = {bubbles: true, cancelable: true, clientX: x, clientY: y,
			button: 0, buttons: (phases[i] === 'down') ? 1 : 0};

		if (usePointer)
		{
			opts.pointerId = 1;
			opts.pointerType = 'mouse';
			opts.isPrimary = true;
			target.dispatchEvent(new PointerEvent('pointer' + phases[i], opts));
		}
		else
		{
			target.dispatchEvent(new MouseEvent('mouse' + phases[i], opts));
		}
	}
};

/**
 * Expression engine. Table driven, because the value of a parser test is in
 * breadth of cases rather than depth of any one.
 */
HmiSelfTest.testExpressions = function()
{
	var project = HmiSelfTest.sampleProject();

	// Extra tags for the lexer traps.
	project.addTag(HmiProject.createTag('Android', 'MemoryInteger'));
	project.addTag(HmiProject.createTag('ORbit', 'MemoryInteger'));
	project.addTag(HmiProject.createTag('NOTch', 'MemoryInteger'));

	var values = {
		'tank_level': {value: 40, quality: HmiTypes.QUALITY_GOOD, timestamp: 100},
		'pump1_run': {value: 1, quality: HmiTypes.QUALITY_GOOD, timestamp: 200},
		'recipe_name': {value: 'Blue', quality: HmiTypes.QUALITY_GOOD, timestamp: 50},
		'android': {value: 7, quality: HmiTypes.QUALITY_GOOD, timestamp: 10},
		'orbit': {value: 3, quality: HmiTypes.QUALITY_GOOD, timestamp: 10},
		'notch': {value: 2, quality: HmiTypes.QUALITY_GOOD, timestamp: 10}
	};

	var written = {};

	var ctx = {
		read: function(name, field)
		{
			var live = values[name.toLowerCase()];

			if (live == null)
			{
				return {value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
			}

			if (field == null || field === 'Value')
			{
				return live;
			}

			var tag = project.getTag(name);
			var map = {Name: name, MinEU: (tag != null) ? tag.minEU : null,
				MaxEU: (tag != null) ? tag.maxEU : null,
				Quality: live.quality, TimeDate: live.timestamp};

			return {value: map[field], quality: HmiTypes.QUALITY_GOOD,
				timestamp: Date.now()};
		},
		write: function(name, value) { written[name] = value; },
		now: function() { return Date.now(); }
	};

	// [source, expected value]  -- expected undefined means "expect an error"
	var cases = [
		// literals and arithmetic
		['1', 1], ['1.5', 1.5], ['-3', -3], ['2 + 3 * 4', 14],
		['(2 + 3) * 4', 20], ['10 / 4', 2.5], ['7 MOD 3', 1],
		['2 ** 3', 8], ['2 ** 3 ** 2', 512], ['- 2 ** 2', -4],
		['"hello"', 'hello'], ['"a" + "b"', 'ab'], ['"n=" + 5', 'n=5'],

		// tag references and dotfields
		['Tank_Level', 40], ['Tank_Level.Value', 40], ['Tank_Level.MaxEU', 100],
		['Tank_Level.MaxEU * 0.9', 90], ['InTouch:Tank_Level', 40],
		['tank_level', 40],

		// comparison
		['Tank_Level > 30', true], ['Tank_Level >= 40', true],
		['Tank_Level < 30', false], ['Tank_Level == 40', true],
		['Tank_Level <> 40', false], ['"10" > 9', true],
		['Recipe_Name == "Blue"', true],

		// boolean words, any case
		['Pump1_Run AND Tank_Level > 30', true],
		['Pump1_Run and Tank_Level > 90', false],
		['Pump1_Run OR Tank_Level > 90', true],
		['NOT Pump1_Run', false], ['not (Tank_Level > 90)', true],

		// precedence: OR below AND
		['Pump1_Run OR Pump1_Run AND 0', true],

		// the lexer traps: tags whose names begin with a word operator
		['Android', 7], ['Android + 1', 8], ['ORbit', 3], ['NOTch', 2],
		['Android AND ORbit', true],

		// comments
		['1 + {this is a comment} 2', 3],
		['{leading} Tank_Level', 40],

		// functions
		['Abs(-5)', 5], ['Min(3, 9)', 3], ['Max(3, 9)', 9],
		['Round(2.6)', 3], ['Int(2.6)', 2], ['Sqrt(9)', 3],
		['Text(7, "000")', '007'],

		// errors
		['Tank_Level +', undefined],
		['NoSuchTag', undefined],
		['Tank_Level.Nonsense', undefined],
		['Abs(1, 2)', undefined],
		['NoSuchFunction(1)', undefined],
		['1 + ', undefined],
		['(1 + 2', undefined],
		['"unterminated', undefined],
		['{unterminated', undefined],
		['Tank_Level = 5', undefined]
	];

	var failures = [];

	for (var i = 0; i < cases.length; i++)
	{
		var src = cases[i][0];
		var want = cases[i][1];
		var compiled = HmiExpr.compile(src, {project: project});

		if (want === undefined)
		{
			if (compiled.errors.length === 0)
			{
				failures.push(src + ' should not compile');
			}

			continue;
		}

		if (compiled.errors.length > 0)
		{
			failures.push(src + ' :: ' + compiled.errors[0].message);
			continue;
		}

		var got = compiled.eval(ctx);

		if (got.value !== want)
		{
			failures.push(src + ' = ' + JSON.stringify(got.value) +
				', wanted ' + JSON.stringify(want));
		}
	}

	HmiSelfTest.check('expr.table', failures.length === 0,
		failures.join(' | '));

	// --- dependencies -----------------------------------------------------

	var deps = HmiExpr.compile('Tank_Level.MaxEU * 0.9 + Android',
		{project: project}).deps;

	HmiSelfTest.check('expr.deps',
		deps.length === 2 && mxUtils.indexOf(deps, 'Tank_Level') >= 0 &&
		mxUtils.indexOf(deps, 'Android') >= 0, deps.join(','));

	// --- quality and timestamp -------------------------------------------

	values['tank_level'] = {value: 40, quality: HmiTypes.QUALITY_BAD,
		timestamp: 999};

	var bad = HmiExpr.compile('Tank_Level + Android', {project: project})
		.eval(ctx);

	HmiSelfTest.check('expr.qualityIsWorstInput',
		bad.quality === HmiTypes.QUALITY_BAD, 'quality = ' + bad.quality);
	HmiSelfTest.check('expr.timestampIsNewest', bad.timestamp === 999,
		'timestamp = ' + bad.timestamp);
	HmiSelfTest.check('expr.badQualityStillComputes', bad.value === 47,
		'value = ' + bad.value);

	values['tank_level'] = {value: 40, quality: HmiTypes.QUALITY_GOOD,
		timestamp: 100};

	// Both sides of a logical are evaluated, so quality cannot depend on
	// which branch happened to decide the answer.
	values['android'] = {value: 1, quality: HmiTypes.QUALITY_BAD, timestamp: 5};

	var shortCircuit = HmiExpr.compile('Tank_Level > 90 AND Android',
		{project: project}).eval(ctx);

	HmiSelfTest.check('expr.noShortCircuitQuality',
		shortCircuit.quality === HmiTypes.QUALITY_BAD,
		'quality = ' + shortCircuit.quality);

	values['android'] = {value: 7, quality: HmiTypes.QUALITY_GOOD, timestamp: 10};

	// --- runtime failures degrade, never throw ---------------------------

	var divZero = HmiExpr.compile('Tank_Level / 0', {project: project})
		.eval(ctx);

	HmiSelfTest.check('expr.divideByZero',
		divZero.quality === HmiTypes.QUALITY_BAD && divZero.error != null,
		'got ' + JSON.stringify(divZero));

	var notNumber = HmiExpr.compile('Recipe_Name * 2', {project: project})
		.eval(ctx);

	HmiSelfTest.check('expr.stringArithmeticIsBad',
		notNumber.quality === HmiTypes.QUALITY_BAD,
		'got ' + JSON.stringify(notNumber));

	// --- scripts ----------------------------------------------------------

	var script = HmiExpr.compile('Tank_Level = 55; Pump1_Run = 1;',
		{project: project, mode: 'script'});

	HmiSelfTest.check('expr.scriptCompiles', script.errors.length === 0,
		(script.errors[0] || {}).message);
	HmiSelfTest.check('expr.scriptWrites',
		script.writes.length === 2 &&
		mxUtils.indexOf(script.writes, 'Tank_Level') >= 0,
		script.writes.join(','));

	written = {};
	script.eval(ctx);

	HmiSelfTest.check('expr.scriptAssigns',
		written['Tank_Level'] === 55 && written['Pump1_Run'] === 1,
		JSON.stringify(written));

	var badTarget = HmiExpr.compile('Tank_Level.MaxEU = 5',
		{project: project, mode: 'script'});

	HmiSelfTest.check('expr.cannotAssignToDotfield',
		badTarget.errors.length > 0);

	// --- cache ------------------------------------------------------------

	var a = HmiExpr.compile('Tank_Level + 1', {project: project});
	var b = HmiExpr.compile('Tank_Level + 1', {project: project});

	HmiSelfTest.check('expr.cacheReturnsSame', a === b);

	// A dictionary edit must not be served a stale compile: this expression
	// is an error now and valid afterwards.
	var before = HmiExpr.compile('LaterTag', {project: project});
	project.addTag(HmiProject.createTag('LaterTag', 'MemoryReal'));
	var after = HmiExpr.compile('LaterTag', {project: project});

	HmiSelfTest.check('expr.cacheInvalidatesOnEdit',
		before.errors.length > 0 && after.errors.length === 0,
		'before=' + before.errors.length + ' after=' + after.errors.length);
};

/**
 * Milestone 2: geometry, percent fill, alarm colour, sliders and scripts.
 *
 * Geometry is asserted through the view's own state, because that is what the
 * shape is drawn from -- and re-asserted after refresh and zoom, since the
 * whole design rests on the adjustment being part of every validation rather
 * than a correction applied once.
 */
HmiSelfTest.testMovement = function(ui)
{
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);
	var model = graph.getModel();
	var project = HmiSelfTest.sampleProject();
	project.getTag('Tank_Level').alarms = {loLo: 5, low: 10, high: 90, hiHi: 95};
	ui.hmiProject = project;

	var cells = {};
	var specs = [
		['rot', 'orientation', {expr: 'Tank_Level', atMin: '0', atMax: '100',
			angleMin: '0', angleMax: '180'}],
		['locH', 'location.horizontal', {expr: 'Tank_Level', atMin: '0',
			atMax: '100', offsetMin: '0', offsetMax: '200'}],
		['locV', 'location.vertical', {expr: 'Tank_Level', atMin: '0',
			atMax: '100', offsetMin: '0', offsetMax: '-100'}],
		['w', 'size.width', {expr: 'Tank_Level', atMin: '0', atMax: '100',
			pctMin: '0', pctMax: '100'}],
		['h', 'size.height', {expr: 'Tank_Level', atMin: '0', atMax: '100',
			pctMin: '50', pctMax: '100'}],
		['fillV', 'percentFill.vertical', {expr: 'Tank_Level', atMin: '0',
			atMax: 'Tank_Level.MaxEU', pctMin: '0', pctMax: '100'}],
		['alarm', 'fillColor.analogAlarm', {tag: 'Tank_Level',
			loLo: '#000011', low: '#000022', normal: '#000033',
			high: '#000044', hiHi: '#000055'}]
	];

	model.beginUpdate();

	try
	{
		for (var i = 0; i < specs.length; i++)
		{
			cells[specs[i][0]] = graph.insertVertex(graph.getDefaultParent(),
				null, '', 60 + i * 130, 420, 100, 80);
		}
	}
	finally
	{
		model.endUpdate();
	}

	for (var i = 0; i < specs.length; i++)
	{
		var links = {};
		links[specs[i][1]] = specs[i][2];
		HmiProject.setCellLinks(graph, cells[specs[i][0]], links);
	}

	var design = {};

	for (var k in cells)
	{
		var st = graph.view.getState(cells[k]);
		design[k] = (st != null) ?
			{x: st.x, y: st.y, width: st.width, height: st.height} : null;
	}

	var sim = new HmiSimulator(project);
	var rt = new HmiRuntime({graph: graph, project: project, driver: sim});
	rt.start();

	function setLevel(v)
	{
		rt.applyBatch({'Tank_Level': {value: v,
			quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()}});
		rt.flush();
		graph.view.validate();
	}

	setLevel(50);

	// --- orientation ------------------------------------------------------

	var rotState = graph.view.getState(cells.rot);

	HmiSelfTest.check('m2.orientation',
		rotState != null && parseFloat(
			rotState.style[mxConstants.STYLE_ROTATION]) === 90,
		'rotation = ' + ((rotState != null) ?
			rotState.style[mxConstants.STYLE_ROTATION] : 'none'));

	// --- location ---------------------------------------------------------

	var scale = graph.view.scale;
	var locH = graph.view.getState(cells.locH);

	HmiSelfTest.check('m2.locationHorizontal',
		Math.abs((locH.x - design.locH.x) - 100 * scale) < 1,
		'dx = ' + (locH.x - design.locH.x) + ', wanted ' + (100 * scale));

	var locV = graph.view.getState(cells.locV);

	HmiSelfTest.check('m2.locationVertical',
		Math.abs((locV.y - design.locV.y) + 50 * scale) < 1,
		'dy = ' + (locV.y - design.locV.y) + ', wanted ' + (-50 * scale));

	// --- size -------------------------------------------------------------

	var wState = graph.view.getState(cells.w);

	HmiSelfTest.check('m2.sizeWidth',
		Math.abs(wState.width - design.w.width * 0.5) < 1,
		'width = ' + wState.width + ', wanted ' + (design.w.width * 0.5));

	var hState = graph.view.getState(cells.h);

	HmiSelfTest.check('m2.sizeHeight',
		Math.abs(hState.height - design.h.height * 0.75) < 1,
		'height = ' + hState.height + ', wanted ' + (design.h.height * 0.75));

	// Default anchor is the top, so the top edge holds and it grows downward.
	HmiSelfTest.check('m2.sizeAnchorTopHoldsTop',
		Math.abs(hState.y - design.h.y) < 1,
		'y moved by ' + (hState.y - design.h.y));

	// Bottom anchor: the bottom edge holds and it grows upward, which is what
	// a bargraph wants.
	var hLinks = HmiProject.getCellLinks(graph, cells.h);
	hLinks['size.height'].anchor = 'bottom';
	HmiProject.setCellLinks(graph, cells.h, hLinks);
	rt.rebind();
	setLevel(50);

	hState = graph.view.getState(cells.h);
	var designBottom = design.h.y + design.h.height;

	HmiSelfTest.check('m2.sizeAnchorBottomHoldsBottom',
		Math.abs((hState.y + hState.height) - designBottom) < 1,
		'bottom moved by ' + ((hState.y + hState.height) - designBottom));

	HmiSelfTest.check('m2.sizeAnchorBottomStillScales',
		Math.abs(hState.height - design.h.height * 0.75) < 1,
		'height = ' + hState.height);

	// Centre anchor: the middle holds.
	hLinks['size.height'].anchor = 'center';
	HmiProject.setCellLinks(graph, cells.h, hLinks);
	rt.rebind();
	setLevel(50);

	hState = graph.view.getState(cells.h);
	var designMiddle = design.h.y + design.h.height / 2;

	HmiSelfTest.check('m2.sizeAnchorCentreHoldsCentre',
		Math.abs((hState.y + hState.height / 2) - designMiddle) < 1,
		'centre moved by ' + ((hState.y + hState.height / 2) - designMiddle));

	hLinks['size.height'].anchor = 'top';
	HmiProject.setCellLinks(graph, cells.h, hLinks);
	rt.rebind();
	setLevel(50);

	// --- percent fill (the spike) ----------------------------------------

	var fillState = graph.view.getState(cells.fillV);
	var clipRef = (fillState != null && fillState.shape != null) ?
		fillState.shape.node.getAttribute('clip-path') : null;

	HmiSelfTest.check('m2.fillClipApplied',
		clipRef != null && clipRef.indexOf('hmiClip-') > 0,
		'clip-path = ' + clipRef);

	var clip = document.getElementById('hmiClip-' + cells.fillV.id);

	HmiSelfTest.check('m2.fillClipHalf',
		clip != null && Math.abs(
			parseFloat(clip.firstChild.getAttribute('height')) - 0.5) < 0.01,
		'height = ' + ((clip != null) ?
			clip.firstChild.getAttribute('height') : 'none'));

	// Vertical fill grows from the bottom, so y is the complement.
	HmiSelfTest.check('m2.fillClipFromBottom',
		clip != null && Math.abs(
			parseFloat(clip.firstChild.getAttribute('y')) - 0.5) < 0.01,
		'y = ' + ((clip != null) ? clip.firstChild.getAttribute('y') : 'none'));

	// --- alarm colour -----------------------------------------------------

	var alarmState = graph.view.getState(cells.alarm);

	HmiSelfTest.check('m2.alarmNormal',
		alarmState.shape.fill === '#000033',
		'fill = ' + alarmState.shape.fill);

	setLevel(97);

	HmiSelfTest.check('m2.alarmHiHi',
		graph.view.getState(cells.alarm).shape.fill === '#000055',
		'fill = ' + graph.view.getState(cells.alarm).shape.fill);

	setLevel(3);

	HmiSelfTest.check('m2.alarmLoLo',
		graph.view.getState(cells.alarm).shape.fill === '#000011',
		'fill = ' + graph.view.getState(cells.alarm).shape.fill);

	// --- survives revalidation -------------------------------------------

	setLevel(50);
	graph.refresh();
	graph.view.validate();

	HmiSelfTest.check('m2.geometrySurvivesRefresh',
		Math.abs((graph.view.getState(cells.locH).x - design.locH.x) -
			100 * graph.view.scale) < 1,
		'dx after refresh = ' +
		(graph.view.getState(cells.locH).x - design.locH.x));

	graph.zoomIn();
	var zoomScale = graph.view.scale;

	HmiSelfTest.check('m2.geometrySurvivesZoom',
		Math.abs((graph.view.getState(cells.locH).x - design.locH.x * 1) -
			100 * zoomScale) < Math.max(2, design.locH.x),
		'offset should scale with zoom');

	var zoomClip = document.getElementById('hmiClip-' + cells.fillV.id);

	HmiSelfTest.check('m2.fillSurvivesZoom',
		zoomClip != null && Math.abs(
			parseFloat(zoomClip.firstChild.getAttribute('height')) - 0.5) < 0.01,
		'objectBoundingBox units should be zoom independent');

	graph.zoomOut();

	// --- the invariant still holds ---------------------------------------

	var modifiedBefore = ui.editor.modified;
	setLevel(20);

	HmiSelfTest.check('m2.modelStillUntouched',
		ui.editor.modified === modifiedBefore,
		'geometry animation must not modify the file');

	rt.stop();

	// Design geometry must come back, and no clip paths left behind.
	graph.view.validate();
	var after = graph.view.getState(cells.locH);

	HmiSelfTest.check('m2.geometryRestored',
		Math.abs(after.x - design.locH.x) < 1,
		'x = ' + after.x + ', design ' + design.locH.x);

	HmiSelfTest.check('m2.clipsRemoved',
		document.getElementById('hmiClip-' + cells.fillV.id) == null);

	HmiSelfTest.clearDraft(ui);
};

/** Sliders, action scripts and window links. */
HmiSelfTest.testM2Interaction = function(ui)
{
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);
	var project = HmiSelfTest.sampleProject();
	ui.hmiProject = project;

	var slider = null;
	var scripted = null;

	graph.getModel().beginUpdate();

	try
	{
		slider = graph.insertVertex(graph.getDefaultParent(), null, '',
			60, 540, 100, 40);
		scripted = graph.insertVertex(graph.getDefaultParent(), null, '',
			200, 540, 100, 40);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	HmiProject.setCellLinks(graph, slider, {
		'slider.horizontal': {tag: 'Tank_Level', atMin: '0', atMax: '100',
			travelMin: '0', travelMax: '100'}
	});

	HmiProject.setCellLinks(graph, scripted, {
		'pushbutton.action': {onDown: 'Pump1_Run = 1;',
			whileDown: '', onUp: 'Pump1_Run = 0;', everyMs: '1000'}
	});

	var sim = new HmiSimulator(project);
	var rt = new HmiRuntime({graph: graph, project: project, driver: sim});
	rt.start();

	// --- slider -----------------------------------------------------------

	rt.applyBatch({'Tank_Level': {value: 0, quality: HmiTypes.QUALITY_GOOD,
		timestamp: Date.now()}});
	rt.flush();

	var fake = {
		x: 0,
		getGraphX: function() { return this.x; },
		getGraphY: function() { return 0; },
		getCell: function() { return slider; }
	};

	rt.downCell = slider;
	rt.beginDrag(slider, fake);
	fake.x = 50 * graph.view.scale;
	rt.handleDrag(fake);

	HmiSelfTest.check('m2.sliderWrites',
		Math.abs(parseFloat(sim.get('Tank_Level').value) - 50) < 1,
		'Tank_Level = ' + sim.get('Tank_Level').value);

	// Travel is clamped, so dragging past the end holds at the limit.
	fake.x = 500 * graph.view.scale;
	rt.handleDrag(fake);

	HmiSelfTest.check('m2.sliderClamps',
		parseFloat(sim.get('Tank_Level').value) === 100,
		'Tank_Level = ' + sim.get('Tank_Level').value);

	rt.downCell = null;

	// --- action script ----------------------------------------------------

	sim.write({'Pump1_Run': 0});
	rt.handleTouch(scripted, 'down');

	HmiSelfTest.check('m2.actionScriptOnDown',
		sim.get('Pump1_Run').value === 1,
		'Pump1_Run = ' + sim.get('Pump1_Run').value);

	rt.handleTouch(scripted, 'up');

	HmiSelfTest.check('m2.actionScriptOnUp',
		sim.get('Pump1_Run').value === 0,
		'Pump1_Run = ' + sim.get('Pump1_Run').value);

	// --- disable blocks touch --------------------------------------------

	HmiProject.setCellLinks(graph, scripted, {
		'pushbutton': {kind: 'discrete', tag: 'Pump1_Run', action: 'set'},
		'disable': {expr: '1'}
	});

	rt.rebind();
	rt.flush();
	sim.write({'Pump1_Run': 0});
	rt.handleTouch(scripted, 'click');

	HmiSelfTest.check('m2.disableBlocksTouch',
		sim.get('Pump1_Run').value === 0,
		'a disabled object accepted a click');

	rt.stop();
	HmiSelfTest.clearDraft(ui);
};

/**
 * Simulator behaviour per tag type.
 *
 * The dictionary offers a Simulation section on every tag type, so the driver
 * has to honour it on every tag type -- otherwise the field silently does
 * nothing on memory tags, which is worse than not offering it.
 */
HmiSelfTest.testSimulation = function()
{
	var project = new HmiProject();
	project.accessNames.push({id: 'PLC1', driver: 'simulator', node: '',
		topic: '', rateMs: 100});

	var io = HmiProject.createTag('IO_Level', 'IOReal');
	io.minEU = 0;
	io.maxEU = 100;
	project.addTag(io);

	// A memory tag with no mode: owned by whoever writes it.
	var held = HmiProject.createTag('Mem_Held', 'MemoryReal');
	held.initial = 42;
	project.addTag(held);

	// A memory tag with a mode chosen in the dictionary: must animate.
	var driven = HmiProject.createTag('Mem_Driven', 'MemoryReal');
	driven.minEU = 0;
	driven.maxEU = 100;
	driven.sim = {mode: 'ramp', periodMs: '1000'};
	project.addTag(driven);

	var discrete = HmiProject.createTag('Mem_Toggle', 'MemoryDiscrete');
	discrete.sim = {mode: 'toggle', periodMs: '1000'};
	project.addTag(discrete);

	var sim = new HmiSimulator(project);
	sim.connect();

	function at(tag, ms)
	{
		return sim.simulate(tag, ms, sim.get(tag.name)).value;
	}

	// I/O animates by default.
	HmiSelfTest.check('sim.ioDefaultsToMoving',
		at(io, 0) !== at(io, 7500),
		'IOReal should move without any profile');

	// A memory tag with no mode holds.
	HmiSelfTest.check('sim.memoryHoldsWithoutMode',
		at(held, 0) === at(held, 7500) && at(held, 0) === 42,
		'Mem_Held = ' + at(held, 0) + ' then ' + at(held, 7500));

	// A memory tag with a mode animates.
	HmiSelfTest.check('sim.memoryFollowsExplicitMode',
		at(driven, 0) !== at(driven, 500),
		'Mem_Driven = ' + at(driven, 0) + ' then ' + at(driven, 500));

	HmiSelfTest.check('sim.memoryRampSpansRange',
		Math.abs(at(driven, 0) - 0) < 1 && Math.abs(at(driven, 900) - 90) < 5,
		'ramp gave ' + at(driven, 0) + ' and ' + at(driven, 900));

	HmiSelfTest.check('sim.memoryDiscreteToggles',
		at(discrete, 100) === 0 && at(discrete, 600) === 1,
		'toggle gave ' + at(discrete, 100) + ' and ' + at(discrete, 600));

	// A write to a held memory tag still sticks, which is what makes
	// pushbuttons work.
	sim.write({'Mem_Held': 7});

	HmiSelfTest.check('sim.writeStillWins',
		sim.get('Mem_Held').value === 7 && at(held, 9000) === 7,
		'Mem_Held = ' + sim.get('Mem_Held').value);

	// Fault injection applies whatever the tag type.
	sim.setFaulted('Mem_Held', true);
	sim.scan();

	HmiSelfTest.check('sim.faultInjectionOnMemory',
		sim.get('Mem_Held').quality === HmiTypes.QUALITY_BAD,
		'quality = ' + sim.get('Mem_Held').quality);

	sim.setFaulted('Mem_Held', false);
};

/**
 * A real file round trip, through the desktop save and read path.
 *
 * Everything else asserts against getFileData/setFileData in memory. This
 * writes an actual .drawio-hmi to disk with the app's own save machinery, reads
 * the bytes back, and loads them -- which is the only way to know the file a
 * person ends up with is the file the tests have been describing.
 *
 * The path comes from urlParams.hmifile.
 */
HmiSelfTest.runFile = function(ui, path)
{
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);

	var project = HmiSelfTest.sampleProject();
	project.getTag('Tank_Level').alarms = {loLo: 5, low: 10, high: 90, hiHi: 95};
	ui.hmiProject = project;

	var cell = null;

	graph.getModel().beginUpdate();

	try
	{
		cell = graph.insertVertex(graph.getDefaultParent(), null, 'Tank',
			40, 40, 120, 80);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	HmiProject.setCellLinks(graph, cell, {
		'fillColor.analog': {expr: 'Tank_Level', bands: [
			{max: 'Tank_Level.MaxEU * 0.9', color: '#00CC00'},
			{max: null, color: '#CC0000'}]},
		'orientation': {expr: 'Tank_Level', atMin: '0', atMax: '100',
			angleMin: '0', angleMax: '180'},
		'pushbutton': {kind: 'discrete', tag: 'Pump1_Run', action: 'toggle',
			enableExpr: 'A == 1;\nB == 2;'}
	});

	var data = ui.getFileData(true);
	var file = new LocalFile(ui, data, path.replace(/^.*[\\\/]/, ''));
	file.fileObject = {path: path, name: path.replace(/^.*[\\\/]/, ''),
		type: 'utf-8'};

	file.save(false, function()
	{
		HmiSelfTest.check('file.disk.saved', true);

		// Read the bytes back, exactly as opening the file would.
		electron.request({action: 'readFile', filename: path, encoding: 'utf-8'},
			function(text)
			{
				HmiSelfTest.verifyFile(ui, text);
			},
			function(e)
			{
				HmiSelfTest.check('file.disk.read', false,
					'could not read back: ' + e);
				HmiSelfTest.finishFile();
			});
	},
	function(e)
	{
		HmiSelfTest.check('file.disk.saved', false, 'save failed: ' + e);
		HmiSelfTest.finishFile();
	});
};

HmiSelfTest.verifyFile = function(ui, text)
{
	// What is actually on disk.
	HmiSelfTest.check('file.disk.hasVersionMarker',
		text.indexOf('hmiVersion="1"') > 0);
	HmiSelfTest.check('file.disk.hasDictionary',
		text.indexOf('<hmiProject') > 0);
	HmiSelfTest.check('file.disk.hasTagFields',
		text.indexOf('Tank_Level') > 0 && text.indexOf('N7:0') > 0);
	HmiSelfTest.check('file.disk.hasAlarms', text.indexOf('hiHi="95"') > 0);
	HmiSelfTest.check('file.disk.hasCellLinks',
		text.indexOf('fillColor.analog') > 0);

	// Still valid drawio XML, so stock drawio can open the diagram.
	HmiSelfTest.check('file.disk.isMxfile',
		text.indexOf('<mxfile') >= 0 && text.indexOf('<diagram') > 0);

	// Now load it as opening would.
	ui.hmiProject = null;
	HmiSelfTest.resetGraph(ui);
	ui.setFileData(text);

	HmiSelfTest.check('file.disk.dictionaryReturns',
		ui.hmiProject != null && ui.hmiProject.tags.length === 3,
		(ui.hmiProject != null) ? 'tags = ' + ui.hmiProject.tags.length : 'null');

	HmiSelfTest.check('file.disk.ioFieldsReturn',
		ui.hmiProject != null &&
		ui.hmiProject.getTag('Tank_Level') != null &&
		ui.hmiProject.getTag('Tank_Level').item === 'N7:0' &&
		ui.hmiProject.getTag('Tank_Level').alarms.hiHi === 95);

	// And the animations came back on the cell.
	var graph = ui.editor.graph;
	var model = graph.getModel();
	var found = null;

	var walk = function(parent)
	{
		var count = model.getChildCount(parent);

		for (var i = 0; i < count; i++)
		{
			var c = model.getChildAt(parent, i);
			var links = HmiProject.getCellLinks(graph, c);

			if (Object.keys(links).length > 0) { found = links; }

			walk(c);
		}
	};

	walk(graph.getDefaultParent());

	HmiSelfTest.check('file.disk.linksReturn',
		found != null && found['fillColor.analog'] != null &&
		found['orientation'] != null && found['pushbutton'] != null,
		(found != null) ? Object.keys(found).join(',') : 'no animated cell');

	HmiSelfTest.check('file.disk.bandExpressionReturns',
		found != null && found['fillColor.analog'] != null &&
		found['fillColor.analog'].bands[0].max === 'Tank_Level.MaxEU * 0.9',
		(found != null && found['fillColor.analog'] != null) ?
			found['fillColor.analog'].bands[0].max : 'none');

	// The multi-line case, which is the one a flat attribute would mangle.
	HmiSelfTest.check('file.disk.newlinesReturn',
		found != null && found['pushbutton'] != null &&
		found['pushbutton'].enableExpr === 'A == 1;\nB == 2;',
		(found != null && found['pushbutton'] != null) ?
			JSON.stringify(found['pushbutton'].enableExpr) : 'none');

	HmiSelfTest.finishFile();
};

HmiSelfTest.finishFile = function()
{
	var failed = 0;

	for (var i = 0; i < HmiSelfTest.results.length; i++)
	{
		if (!HmiSelfTest.results[i].pass) { failed++; }
	}

	console.log('HMIFILE DONE total=' + HmiSelfTest.results.length +
		' failed=' + failed);
};

/**
 * File naming and the save-dialog file types.
 *
 * Registering the HMI type is not just a matter of adding it to the list:
 * diagramFileTypes[0] is taken as the default by the filename dialog and the
 * new-file flow, and upstream's normalizeFilename does not recognise a
 * two-part extension.
 */
HmiSelfTest.testFilenames = function(ui)
{
	var types = ui.editor.diagramFileTypes;

	HmiSelfTest.check('name.typeRegistered',
		HmiSelfTest.hasFileType(types, 'drawio-hmi'),
		types.map(function(t) { return t.extension; }).join(','));

	// Ours must not lead, or every new diagram is named after it.
	HmiSelfTest.check('name.drawioStillDefault',
		types[0].extension === 'drawio',
		'first type is .' + types[0].extension);

	var saved = ui.hmiProject;

	// A plain diagram keeps the ordinary extension.
	ui.hmiProject = new HmiProject();

	HmiSelfTest.check('name.plainKeepsDrawio',
		ui.normalizeFilename('Untitled Diagram.drawio') ===
			'Untitled Diagram.drawio',
		ui.normalizeFilename('Untitled Diagram.drawio'));

	// A document with a dictionary suggests ours.
	ui.hmiProject = HmiSelfTest.sampleProject();

	HmiSelfTest.check('name.hmiSuggestsExtension',
		ui.normalizeFilename('Untitled Diagram.drawio') ===
			'Untitled Diagram.drawio-hmi',
		ui.normalizeFilename('Untitled Diagram.drawio'));

	// And a name that already carries ours is left alone, rather than coming
	// back as Name.drawio-hmi.drawio.
	HmiSelfTest.check('name.noDoubleExtension',
		ui.normalizeFilename('Plant.drawio-hmi') === 'Plant.drawio-hmi',
		ui.normalizeFilename('Plant.drawio-hmi'));

	// An explicit export format still wins.
	HmiSelfTest.check('name.explicitFormatWins',
		ui.normalizeFilename('Plant.svg', 'svg') === 'Plant.svg',
		ui.normalizeFilename('Plant.svg', 'svg'));

	// The open dialog offers ours alongside drawio.
	var filters = HmiFile.withHmiFilter([
		{name: 'Diagram', extensions: ['drawio', 'xml']}]);

	HmiSelfTest.check('name.openFilterIncludesHmi',
		mxUtils.indexOf(filters[0].extensions, 'drawio-hmi') >= 0,
		filters[0].extensions.join(','));

	ui.hmiProject = saved;
};

HmiSelfTest.hasFileType = function(types, ext)
{
	for (var i = 0; i < types.length; i++)
	{
		if (types[i].extension === ext) { return true; }
	}

	return false;
};

/** Discrete Value Display text, and where it comes from. */
HmiSelfTest.testDiscreteText = function(ui)
{
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);

	var project = HmiSelfTest.sampleProject();
	project.getTag('Pump1_Run').onMsg = 'RUNNING';
	project.getTag('Pump1_Run').offMsg = 'STOPPED';
	ui.hmiProject = project;

	var sim = new HmiSimulator(project);
	var rt = new HmiRuntime({graph: graph, project: project, driver: sim});
	rt.project = project;
	rt.values = {};

	function show(cfg, value)
	{
		rt.values['pump1_run'] = {value: value,
			quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};
		rt.values['tank_level'] = {value: 80,
			quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};

		return rt.formatValue(cfg);
	}

	// With no link text, the tag's messages are used.
	var fromTag = {kind: 'discrete', expr: 'Pump1_Run', prefix: '', suffix: ''};

	HmiSelfTest.check('valueDisplay.discreteUsesTagMessages',
		show(fromTag, 1) === 'RUNNING' && show(fromTag, 0) === 'STOPPED',
		show(fromTag, 1) + ' / ' + show(fromTag, 0));

	// The link's own text overrides the tag.
	var override = {kind: 'discrete', expr: 'Pump1_Run',
		onText: 'OPEN', offText: 'CLOSED', prefix: '', suffix: ''};

	HmiSelfTest.check('valueDisplay.discreteLinkTextWins',
		show(override, 1) === 'OPEN' && show(override, 0) === 'CLOSED',
		show(override, 1) + ' / ' + show(override, 0));

	// One side only: the other still falls back.
	var partial = {kind: 'discrete', expr: 'Pump1_Run', onText: 'OPEN',
		offText: '', prefix: '', suffix: ''};

	HmiSelfTest.check('valueDisplay.discretePartialOverride',
		show(partial, 1) === 'OPEN' && show(partial, 0) === 'STOPPED',
		show(partial, 1) + ' / ' + show(partial, 0));

	// An expression is not a tag, so there are no messages to borrow -- this
	// is exactly when the link's own text has to work.
	var expr = {kind: 'discrete', expr: 'Tank_Level > 50',
		onText: 'HIGH', offText: 'LOW', prefix: '', suffix: ''};

	HmiSelfTest.check('valueDisplay.discreteOnExpression',
		show(expr, 0) === 'HIGH',
		'expression form gave ' + show(expr, 0));

	// With neither, a plain default rather than nothing.
	var bare = {kind: 'discrete', expr: 'Tank_Level > 50', prefix: '',
		suffix: ''};

	HmiSelfTest.check('valueDisplay.discreteFallsBackToOnOff',
		bare != null && show(bare, 0) === 'On',
		show(bare, 0));

	// Prefix and suffix still apply.
	var wrapped = {kind: 'discrete', expr: 'Pump1_Run', onText: 'OPEN',
		offText: 'CLOSED', prefix: 'V1 ', suffix: '!'};

	HmiSelfTest.check('valueDisplay.discreteKeepsAffixes',
		show(wrapped, 1) === 'V1 OPEN!', show(wrapped, 1));

	HmiSelfTest.clearDraft(ui);
};

/** The Action Script editors must actually be editable. */
HmiSelfTest.testScriptFields = function(ui)
{
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);
	ui.hmiProject = HmiSelfTest.sampleProject();

	var cell = null;

	graph.getModel().beginUpdate();

	try
	{
		cell = graph.insertVertex(graph.getDefaultParent(), null, 'Btn',
			60, 620, 100, 40);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	HmiProject.setCellLinks(graph, cell, {
		'pushbutton.action': HmiTypes.LINKS['pushbutton.action'].defaults()
	});

	ui.hmiUiState = {expanded: {'pushbutton.action': true}};
	ui.format.collapsedSections = {};
	graph.setSelectionCell(cell);
	ui.format.immediateRefresh();

	var strip = ui.format.container.firstChild;

	if (strip == null || strip.childNodes.length !== 4)
	{
		HmiSelfTest.check('script.tab', false, 'no Animation tab');

		return;
	}

	strip.childNodes[3].click();

	var panel = ui.format.container.childNodes[4];
	var areas = panel.getElementsByTagName('textarea');

	HmiSelfTest.check('script.fieldsRendered', areas.length === 3,
		'found ' + areas.length + ' script fields');

	if (areas.length === 0)
	{
		return;
	}

	var a = areas[0];
	var style = window.getComputedStyle(a);

	HmiSelfTest.check('script.notDisabled', !a.disabled && !a.readOnly,
		'disabled=' + a.disabled + ' readOnly=' + a.readOnly);
	HmiSelfTest.check('script.acceptsPointer',
		style.pointerEvents !== 'none',
		'pointer-events = ' + style.pointerEvents);
	HmiSelfTest.check('script.hasSize',
		a.offsetHeight > 0 && a.offsetWidth > 0,
		a.offsetWidth + 'x' + a.offsetHeight);
	HmiSelfTest.check('script.visible',
		style.visibility !== 'hidden' && style.display !== 'none',
		'visibility=' + style.visibility + ' display=' + style.display);

	// Typing into it must reach the model.
	a.focus();

	HmiSelfTest.check('script.focusable', document.activeElement === a,
		'active element is ' +
		((document.activeElement != null) ?
			document.activeElement.nodeName : 'none'));

	// A textarea must not be transparent here: it would read as disabled
	// beside the filled input fields around it.
	HmiSelfTest.check('script.looksEditable',
		style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
		style.backgroundColor !== 'transparent',
		'background = ' + style.backgroundColor);

	// Dispatch the event rather than calling blur(): a programmatic blur does
	// not reliably fire when the window itself is not focused, which is the
	// usual state for an automated run.
	a.value = 'Pump1_Run = 1;';
	a.dispatchEvent(new Event('input', {bubbles: true}));
	a.dispatchEvent(new FocusEvent('blur'));

	var back = HmiProject.getCellLinks(graph, cell)['pushbutton.action'];

	HmiSelfTest.check('script.commitsOnBlur',
		back != null && back.onDown === 'Pump1_Run = 1;',
		'stored ' + ((back != null) ? JSON.stringify(back.onDown) : 'nothing'));

	HmiSelfTest.clearDraft(ui);
};
