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
		HmiSelfTest.testProjectRoundTrip();
		HmiSelfTest.testCellLinks(ui);
		HmiSelfTest.testFileRoundTrip(ui);
		HmiSelfTest.testFormatTab(ui);
		HmiSelfTest.testRuntime(ui);
		HmiSelfTest.testMenusAndDialogs(ui);
	}
	catch (e)
	{
		console.log('HMITEST FAIL harness :: ' + e.message + ' @ ' + e.stack);
	}

	// The test edits the graph and the dictionary, which marks the file
	// modified and leaves autosave drafts behind -- so every later launch
	// would open with a draft-recovery prompt. Clear it down.
	try
	{
		if (HmiMenus.isRunning(ui))
		{
			HmiMenus.stop(ui);
		}

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

	// --- run / stop -------------------------------------------------------

	ui.hmiProject = HmiSelfTest.sampleProject();

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
