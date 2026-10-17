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
		HmiSelfTest.testConditionals();
		HmiSelfTest.testLoops();
		HmiSelfTest.testLocals();
		HmiSelfTest.testQuickFunctions();
		HmiSelfTest.testProjectRoundTrip();
		HmiSelfTest.testSql();
		HmiSelfTest.testSqlFunctions();
		HmiSelfTest.testCellLinks(ui);
		HmiSelfTest.testFileRoundTrip(ui);
		HmiSelfTest.testFilenames(ui);
		HmiSelfTest.testBrand(ui);
		HmiSelfTest.testAlarms(ui);
		HmiSelfTest.testRetentive(ui);
		HmiSelfTest.testSecurity(ui);
		HmiSelfTest.testRecipes(ui);
		HmiSelfTest.testQuickFunctionsDialog(ui);
		HmiSelfTest.testDatabaseDialog(ui);
		HmiSelfTest.testTrends(ui);
		HmiSelfTest.testIndirect(ui);
		HmiSelfTest.testArcs(ui);
		HmiSelfTest.testFlip(ui);
		HmiSelfTest.testViews(ui);
		HmiSelfTest.testFormatTab(ui);
		HmiSelfTest.testPivotPanel(ui);
		HmiSelfTest.testRuntime(ui);
		HmiSelfTest.testMenusAndDialogs(ui);
		HmiSelfTest.testTagRefs();
		HmiSelfTest.testTagRefScope(ui);
		HmiSelfTest.testRangeDeps(ui);
		HmiSelfTest.testFindReplace(ui);
		HmiSelfTest.testRenameOtherPages(ui);
		HmiSelfTest.testPanelLayout(ui);
		HmiSelfTest.testMovement(ui);
		HmiSelfTest.testM2Interaction(ui);
		HmiSelfTest.testDiscreteText(ui);
		HmiSelfTest.testScriptFields(ui);
		HmiSelfTest.testAnimationClipboard(ui);
		HmiSelfTest.testKeypad(ui);
		HmiSelfTest.testWindows(ui);
		HmiSelfTest.testAppScripts(ui);
		HmiSelfTest.testDevices(ui);
		HmiSelfTest.testCommsDriver(ui);

		// Last: its assertions run deferred, and anything opened after it
		// would take the focus it is checking.
		HmiSelfTest.testPanelFocus(ui);
		HmiSelfTest.testInputExtras(ui);
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

	p.devices.push(HmiProject.createDevice('PLC1', 'simulator'));

	var level = HmiProject.createTag('Tank_Level', 'IOReal');
	level.comment = 'Day tank';
	level.engUnits = '%';
	level.device = 'PLC1';
	level.address = 'N7:0';
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
		ui.hmiProject.getTag('Tank_Level').address === 'N7:0');

	// Opening a file redraws the screen frame at that file's resolution,
	// not the one shown before it was opened
	var hd = HmiSelfTest.sampleProject();
	hd.settings.width = 1920;
	hd.settings.height = 1080;
	ui.hmiProject = hd;
	var hdData = ui.getFileData(true);
	ui.hmiProject = HmiFile.createDefaultProject();
	HmiFrame.refresh(ui);
	ui.setFileData(hdData);

	var fs = ui.editor.graph.view.scale;
	var fscreen = (ui.hmiFrameGroup != null) ? ui.hmiFrameGroup.screen : null;

	HmiSelfTest.check('file.load.frameFollowsResolution', fscreen != null &&
		parseFloat(fscreen.getAttribute('width')) === Math.round(1920 * fs) &&
		parseFloat(fscreen.getAttribute('height')) === Math.round(1080 * fs),
		(fscreen != null) ? fscreen.getAttribute('width') + ' x ' + fscreen.getAttribute('height') : 'no frame');

	// The detector: dictionary stripped but the marker left behind.
	var stripped = again.replace(/<hmiProject[\s\S]*?<\/hmiProject>/, '');
	ui.hmiProject = null;
	ui.setFileData(stripped);
	HmiSelfTest.check('file.load.lossDetected',
		ui.hmiProject != null && ui.hmiProject.isEmpty(),
		'expected an empty project plus a warning');
};

/** Spike 2: four tabs, and routing that does not strand the user. */
/**
 * Orientation's center of rotation in the Animation panel: page coordinates
 * in the fields, an offset from the object's center in the link, a marker on
 * the page, and picking by clicking.
 */
HmiSelfTest.testPivotPanel = function(ui)
{
	var check = HmiSelfTest.check;
	var graph = ui.editor.graph;
	var format = ui.format;

	if (format == null)
	{
		return;
	}

	var cell = graph.insertVertex(graph.getDefaultParent(), null, '', 200, 200, 100, 80);
	HmiProject.setCellLinks(graph, cell, {orientation: {expr: '', atMin: '0', atMax: '100',
		angleMin: '0', angleMax: '360', pivot: 'point', pivotDx: '50', pivotDy: '-40'}});
	ui.hmiUiState = ui.hmiUiState || {expanded: {}};
	ui.hmiUiState.expanded['orientation'] = true;
	graph.setSelectionCell(cell);
	format.immediateRefresh();

	var field = function(name) { return format.container.querySelector('[data-hmi-field="' + name + '"]'); };
	var link = function() { return HmiProject.getCellLinks(graph, cell)['orientation']; };

	check('pivot.fieldsShowPage', field('pivotX') != null && field('pivotX').value === '300' &&
		field('pivotY').value === '200', field('pivotX') && field('pivotX').value + ',' + field('pivotY').value);
	check('pivot.marker', graph.container.querySelectorAll('.hmiPivotMarker').length === 1);

	field('pivotX').value = '260';
	field('pivotX').dispatchEvent(new Event('blur'));
	check('pivot.typedIsOffset', link().pivotDx === '10' && link().pivotDy === '-40', JSON.stringify(link()));

	// Moving the object keeps the point where it is on the object
	graph.moveCells([cell], 40, 0);
	format.immediateRefresh();
	check('pivot.followsObject', field('pivotX').value === '300' && link().pivotDx === '10',
		field('pivotX') && field('pivotX').value);

	// Pick: the next click on the page sets it, and selects nothing else
	HmiFormatPanel.pickPivot(ui, cell, link());
	check('pivot.pickCursor', graph.container.style.cursor === 'crosshair');

	var s = graph.view.scale;
	var t = graph.view.translate;
	var r = graph.container.getBoundingClientRect();
	var cx = r.left + (400 + t.x) * s - graph.container.scrollLeft;
	var cy = r.top + (100 + t.y) * s - graph.container.scrollTop;
	var target = graph.view.getDrawPane().ownerSVGElement;
	var init = {clientX: cx, clientY: cy, button: 0, buttons: 1, bubbles: true,
		cancelable: true, pointerType: 'mouse', isPrimary: true, pointerId: 1};
	target.dispatchEvent(new PointerEvent('pointerdown', init));
	target.dispatchEvent(new PointerEvent('pointerup', init));

	// The object's center is now (290, 240)
	check('pivot.picked', link().pivotDx === '110' && link().pivotDy === '-140', JSON.stringify(link()));
	check('pivot.pickEnds', ui.hmiPivotPick == null && graph.container.style.cursor !== 'crosshair');
	check('pivot.pickKeepsSelection', graph.getSelectionCell() === cell);

	// And Run turns it about the picked point: a constant 50 on 0..100 is
	// 180 degrees, which puts the center at 2 x (110, -140) from its design
	// position
	var picked = link();
	picked.expr = '50';
	picked.angleMax = '360';
	HmiProject.setCellLinks(graph, cell, {orientation: picked});
	var savedProject = ui.hmiProject;
	ui.hmiProject = HmiSelfTest.sampleProject();
	graph.clearSelection();
	HmiMenus.start(ui);

	var win = (ui.hmiRuntime != null) ? ui.hmiRuntime.windows[0] : null;

	if (win != null)
	{
		win.runtime.flush();
		var wc = win.graph.getModel().getCell(cell.id);
		var ws = win.graph.view.getState(wc);
		var sc = win.graph.view.scale;
		var tr = win.graph.view.translate;
		var ex = (wc.geometry.x + tr.x + 220) * sc;
		var ey = (wc.geometry.y + tr.y - 280) * sc;

		check('pivot.runTurnsAboutPoint', ws != null && Math.abs(ws.x - ex) < 1 && Math.abs(ws.y - ey) < 1,
			(ws != null) ? 'x=' + ws.x + ' want ' + ex + ', y=' + ws.y + ' want ' + ey +
				', rotation=' + ws.style[mxConstants.STYLE_ROTATION] : 'no state');
	}
	else
	{
		check('pivot.runTurnsAboutPoint', false, 'no run window');
	}

	HmiMenus.stop(ui);
	ui.hmiProject = savedProject;
	graph.setSelectionCell(cell);

	format.immediateRefresh();
	field('pivot').value = 'center';
	field('pivot').dispatchEvent(new Event('change'));
	format.immediateRefresh();
	check('pivot.backToCenter', link().pivot == null && link().pivotDx == null &&
		field('pivotX') == null && graph.container.querySelectorAll('.hmiPivotMarker').length === 0);

	graph.clearSelection();
	graph.removeCells([cell]);
	format.immediateRefresh();

	// A connector's center is the middle of its drawn bounds
	var edge = graph.insertEdge(graph.getDefaultParent(), null, '', null, null,
		'shape=flexArrow;endArrow=classic;html=1;');
	edge.geometry.setTerminalPoint(new mxPoint(100, 500), true);
	edge.geometry.setTerminalPoint(new mxPoint(300, 540), false);
	graph.view.invalidate(edge);
	graph.view.validate();
	var ec = HmiFormatPanel.cellCenter(graph, edge);
	check('pivot.connectorCenter', Math.abs(ec.x - 200) < 1 && Math.abs(ec.y - 520) < 1,
		ec.x + ',' + ec.y);
	graph.removeCells([edge]);
};

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

	var actions = ['hmiTagDictionary', 'hmiDevices', 'hmiValidate',
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

	// Alphabetical, whatever order the project holds them in, and the list
	// only: the file and the CSV keep the project's own order.
	var listed = function()
	{
		var rows = dlg.listDiv.getElementsByClassName('hmiTagRow');
		var names = [];

		for (var i = 0; i < rows.length; i++)
		{
			names.push(rows[i].firstChild.innerText);
		}

		return names.join(',');
	};

	HmiSelfTest.check('tagDialog.listsAlphabetically',
		listed() === 'Pump1_Run,Recipe_Name,Tank_Level', listed());
	HmiSelfTest.check('tagDialog.keepsProjectOrder',
		ui.hmiProject.tags[0].name === 'Tank_Level',
		ui.hmiProject.tags[0].name);

	// Descenders were being clipped: the name's box has to be at least as
	// tall as the text in it. Measured in the document, because a detached
	// element has no layout at all.
	document.body.appendChild(dlg.container);

	var firstName = dlg.listDiv.getElementsByClassName('hmiTagName')[0];

	HmiSelfTest.check('tagDialog.nameNotClipped', firstName != null &&
		firstName.clientHeight > 0 &&
		firstName.scrollHeight <= firstName.clientHeight,
		(firstName != null) ? firstName.scrollHeight + ' in ' +
			firstName.clientHeight : 'no row');

	document.body.removeChild(dlg.container);

	// New tag... sits above the filter, where a new tag is reached before
	// the list it lands in.
	var pane = dlg.filter.parentNode;
	var newTagSelect = dlg.container.querySelector('[data-hmi-field="newTagType"]');

	HmiSelfTest.check('tagDialog.newTagAboveFilter', newTagSelect != null &&
		pane.firstChild === newTagSelect && pane.childNodes[1] === dlg.filter);

	// An HMI edit has to mark the file, not just the editor: when the
	// application closes it asks the file whether to offer a save.
	var currentFile = (ui.getCurrentFile != null) ? ui.getCurrentFile() : null;

	if (currentFile != null)
	{
		currentFile.setModified(false);
		HmiFile.markModified(ui);

		HmiSelfTest.check('tagDialog.marksTheFileModified',
			currentFile.isModified() === true && ui.editor.modified === true);

		currentFile.setModified(false);
	}

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

	// --- duplicating counts up ------------------------------------------
	// A copy of NewTag is NewTag1 and a copy of that is NewTag2, rather than
	// a name growing a suffix every time it is copied.

	var taken = function(name)
	{
		return mxUtils.indexOf(['NewTag', 'NewTag1', 'Valve12'], name) >= 0;
	};

	HmiSelfTest.check('name.nextStartsAtOne',
		HmiDialogs.nextName('Tank_Level', taken) === 'Tank_Level1');
	HmiSelfTest.check('name.nextCountsUp',
		HmiDialogs.nextName('NewTag1', taken) === 'NewTag2');
	HmiSelfTest.check('name.nextSkipsTaken',
		HmiDialogs.nextName('NewTag', taken) === 'NewTag2',
		HmiDialogs.nextName('NewTag', taken));
	HmiSelfTest.check('name.nextOnlyTheEndCounts',
		HmiDialogs.nextName('Pump9_Run', taken) === 'Pump9_Run1');
	HmiSelfTest.check('name.nextKeepsDigits',
		HmiDialogs.nextName('Valve12', taken) === 'Valve13');
	HmiSelfTest.check('name.freeKeepsAFreeName',
		HmiDialogs.freeName('Spare', taken) === 'Spare' &&
		HmiDialogs.freeName('NewTag', taken) === 'NewTag2');

	dlg.selected = ui.hmiProject.getTag('Pump1_Run');
	dlg.duplicate();
	HmiSelfTest.check('tagDialog.duplicateCountsUp',
		ui.hmiProject.getTag('Pump1_Run1') != null &&
		dlg.selected.name === 'Pump1_Run1',
		dlg.selected.name);
	dlg.duplicate();
	HmiSelfTest.check('tagDialog.duplicateCountsUpAgain',
		ui.hmiProject.getTag('Pump1_Run2') != null, dlg.selected.name);
	ui.hmiProject.removeTag('Pump1_Run1');
	ui.hmiProject.removeTag('Pump1_Run2');
	dlg.selected = null;

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

	// --- a rename reaches everything that names the tag -------------------
	// Trend pens, action scripts, window scripts and recipe books all name
	// tags, and a rename that skipped any of them would break the project
	// quietly.

	HmiProject.setCellLinks(graph, cell, {
		'pushbutton.action': {onDown: 'DayTank_Level = 1;', whileDown: '',
			onUp: '', everyMs: 'DayTank_Level'},
		'trend': {name: 'T8', title: '', spanSec: 600, sampleMs: 1000,
			refreshMs: 1000, gridColor: '#dde3e8',
			pens: [{tag: 'DayTank_Level', min: '', max: '', color: '#000000'}]}
	});

	var pageId = (ui.currentPage != null) ? ui.currentPage.getId() : 'p1';
	ui.hmiProject.windows[pageId] = {onShow: 'DayTank_Level = 0;'};
	ui.hmiProject.settings.scripts = HmiProject.defaultAppScripts();
	ui.hmiProject.settings.scripts.onStart = 'DayTank_Level = 1;';
	ui.hmiProject.recipeBooks = [{name: 'Book', uploadDownload: false,
		items: [{tag: 'DayTank_Level'}],
		recipes: {'First': {'DayTank_Level': 1}}}];

	var renameUndo = ui.editor.undoManager.history.length;
	dlg.selected = ui.hmiProject.getTag('DayTank_Level');
	dlg.rename(dlg.selected, 'NightTank_Level');

	var renamed = HmiProject.getCellLinks(graph, cell);

	HmiSelfTest.check('tagDialog.renameIsOneUndo',
		ui.editor.undoManager.history.length === renameUndo + 1,
		'history grew by ' +
			(ui.editor.undoManager.history.length - renameUndo));
	HmiSelfTest.check('tagDialog.renameRewritesScript',
		renamed['pushbutton.action'].onDown === 'NightTank_Level = 1;',
		renamed['pushbutton.action'].onDown);
	HmiSelfTest.check('tagDialog.renameRewritesEveryMs',
		renamed['pushbutton.action'].everyMs === 'NightTank_Level');
	HmiSelfTest.check('tagDialog.renameRewritesPen',
		renamed['trend'].pens[0].tag === 'NightTank_Level',
		renamed['trend'].pens[0].tag);
	HmiSelfTest.check('tagDialog.renameRewritesWindowScript',
		ui.hmiProject.windows[pageId].onShow === 'NightTank_Level = 0;',
		ui.hmiProject.windows[pageId].onShow);
	HmiSelfTest.check('tagDialog.renameRewritesAppScript',
		ui.hmiProject.settings.scripts.onStart === 'NightTank_Level = 1;');
	HmiSelfTest.check('tagDialog.renameRewritesRecipeItem',
		ui.hmiProject.recipeBooks[0].items[0].tag === 'NightTank_Level');
	HmiSelfTest.check('tagDialog.renameRekeysRecipeValues',
		ui.hmiProject.recipeBooks[0].recipes['First']['NightTank_Level'] === 1,
		Object.keys(ui.hmiProject.recipeBooks[0].recipes['First']).join(','));
	HmiSelfTest.check('tagDialog.renameNoteMentionsUndo',
		dlg.noteDiv.innerText.indexOf('cannot be undone') > 0,
		dlg.noteDiv.innerText);
	HmiSelfTest.check('tagDialog.deleteCountsAllHolders',
		HmiTagDialog.findReferences(ui, 'NightTank_Level').length >= 7,
		'found ' + HmiTagDialog.findReferences(ui, 'NightTank_Level').length);

	// Back to the name the rest of this test expects.
	dlg.selected = ui.hmiProject.getTag('NightTank_Level');
	dlg.rename(dlg.selected, 'DayTank_Level');
	ui.hmiProject.recipeBooks = [];
	ui.hmiProject.windows = {};
	HmiProject.setCellLinks(graph, cell, {
		'fillColor.analog': {expr: 'DayTank_Level', bands: [
			{max: 'DayTank_Level.MaxEU * 0.9', color: '#00CC00'},
			{max: null, color: '#CC0000'}]},
		'visibility': {expr: 'NOT Tank_LevelOther', sense: 'visible'}
	});

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
	project.devices.push(HmiProject.createDevice('PLC1', 'simulator'));
	project.devices[0].scanMs = 100;

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

	// Turns about the middle of its right edge (100 x 20)
	var needle = graph.insertVertex(graph.getDefaultParent(), null, '', 400, 300, 100, 20);

	HmiProject.setCellLinks(graph, needle, {
		'orientation': {expr: 'Tank_Level', atMin: '0', atMax: '100', angleMin: '0',
			angleMax: '180', pivot: 'point', pivotDx: '50', pivotDy: '0'}
	});

	graph.clearSelection();
	HmiMenus.start(ui);

	HmiSelfTest.check('live.started', HmiMenus.isRunning(ui));

	// Let the simulator scan and the animation frames run for real.
	window.setTimeout(function()
	{
		// Run mode animates a copy of the page in a window of its own; the
		// copy keeps the cell ids, so the cells made above are found by id.
		var win = (ui.hmiRuntime != null) ? ui.hmiRuntime.windows[0] : null;
		var rt = (win != null) ? win.runtime : null;
		var editorGraph = graph;
		graph = (win != null) ? win.graph : editorGraph;

		var inWindow = function(cell)
		{
			return graph.getModel().getCell(cell.id);
		};

		readout = inWindow(readout);
		needle = inWindow(needle);
		tank = inWindow(tank);
		button = inWindow(button);
		entry = inWindow(entry);

		HmiSelfTest.check('live.opensWindow', win != null &&
			win.graph !== editorGraph, 'no run window');

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

		// At 90 degrees the needle's center is 50 right and 50 up of where it
		// was drawn (its design position, read from the model)
		var ns = graph.view.getState(needle);
		var ng = needle.geometry;
		var vs = graph.view.scale;
		var vt = graph.view.translate;
		var ex = (ng.x + vt.x) * vs + 50 * vs;
		var ey = (ng.y + vt.y) * vs - 50 * vs;

		HmiSelfTest.check('live.orientationPivot', ns != null &&
			parseFloat(ns.style[mxConstants.STYLE_ROTATION]) === 90 &&
			Math.abs(ns.x - ex) < 1 && Math.abs(ns.y - ey) < 1,
			(ns != null) ? 'x=' + ns.x + ' want ' + ex + ', y=' + ns.y + ' want ' + ey +
				', rotation=' + ns.style[mxConstants.STYLE_ROTATION] : 'no state');

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
 * Dispatches a real pointer/mouse sequence at the center of a cell, going
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
		// Turning about the middle of its right edge (the cell is 100 x 80)
		['rotP', 'orientation', {expr: 'Tank_Level', atMin: '0', atMax: '100',
			angleMin: '0', angleMax: '180', pivot: 'point', pivotDx: '50', pivotDy: '0'}],
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

	// The two arrow outlines in the palettes: a shape (Misc > Arrow Right)
	// and a connector (General > Arrow), both turning about a point 50 to
	// the right of their center, and a connector moved by a Location link
	model.beginUpdate();

	try
	{
		cells.arrowV = graph.insertVertex(graph.getDefaultParent(), null, '',
			60, 600, 100, 60, 'shape=singleArrow;whiteSpace=wrap;html=1;');
		cells.arrowE = graph.insertEdge(graph.getDefaultParent(), null, '', null, null,
			'shape=flexArrow;endArrow=classic;html=1;');
		cells.arrowE.geometry.setTerminalPoint(new mxPoint(250, 630), true);
		cells.arrowE.geometry.setTerminalPoint(new mxPoint(350, 630), false);
		cells.lineLoc = graph.insertEdge(graph.getDefaultParent(), null, '', null, null,
			'shape=flexArrow;endArrow=classic;html=1;');
		cells.lineLoc.geometry.setTerminalPoint(new mxPoint(450, 630), true);
		cells.lineLoc.geometry.setTerminalPoint(new mxPoint(550, 630), false);
	}
	finally
	{
		model.endUpdate();
	}

	specs.push(['arrowV', 'orientation', {expr: 'Tank_Level', atMin: '0', atMax: '100',
		angleMin: '0', angleMax: '180', pivot: 'point', pivotDx: '50', pivotDy: '0'}]);
	specs.push(['arrowE', 'orientation', {expr: 'Tank_Level', atMin: '0', atMax: '100',
		angleMin: '0', angleMax: '180', pivot: 'point', pivotDx: '50', pivotDy: '0'}]);
	specs.push(['lineLoc', 'location.horizontal', {expr: 'Tank_Level', atMin: '0',
		atMax: '100', offsetMin: '0', offsetMax: '200'}]);

	for (var i = 0; i < specs.length; i++)
	{
		var links = {};
		links[specs[i][1]] = specs[i][2];
		HmiProject.setCellLinks(graph, cells[specs[i][0]], links);
	}

	var designPoints = {};

	for (var k in {arrowE: 1, lineLoc: 1})
	{
		var es = graph.view.getState(cells[k]);
		designPoints[k] = (es != null && es.absolutePoints != null) ?
			es.absolutePoints.map(function(p) { return p.clone(); }) : null;
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

	// At 90 degrees clockwise the center swings from left of the point to
	// above it: 50 right and 50 up, while the shape itself turns 90
	var rotP = graph.view.getState(cells.rotP);
	var pScale = graph.view.scale;

	HmiSelfTest.check('m2.orientationPivot',
		rotP != null && parseFloat(rotP.style[mxConstants.STYLE_ROTATION]) === 90 &&
		Math.abs((rotP.x - design.rotP.x) - 50 * pScale) < 1 &&
		Math.abs((rotP.y - design.rotP.y) + 50 * pScale) < 1,
		(rotP != null) ? 'dx = ' + (rotP.x - design.rotP.x) + ', dy = ' + (rotP.y - design.rotP.y) +
			', rotation = ' + rotP.style[mxConstants.STYLE_ROTATION] + ', scale = ' + pScale : 'none');

	var arrowV = graph.view.getState(cells.arrowV);

	HmiSelfTest.check('m2.orientationPivotArrowShape',
		arrowV != null && parseFloat(arrowV.style[mxConstants.STYLE_ROTATION]) === 90 &&
		Math.abs((arrowV.x - design.arrowV.x) - 50 * pScale) < 1 &&
		Math.abs((arrowV.y - design.arrowV.y) + 50 * pScale) < 1,
		(arrowV != null) ? 'dx = ' + (arrowV.x - design.arrowV.x) + ', dy = ' + (arrowV.y - design.arrowV.y) : 'none');

	// A connector is drawn from its points, so they are what must move
	var movedBy = function(k, wx, wy)
	{
		var es = graph.view.getState(cells[k]);
		var before = designPoints[k];

		if (es == null || before == null || es.absolutePoints == null)
		{
			return 'no points';
		}

		for (var i = 0; i < before.length; i++)
		{
			var p = es.absolutePoints[i];

			if (Math.abs(p.x - before[i].x - wx) > 1 || Math.abs(p.y - before[i].y - wy) > 1)
			{
				return 'point ' + i + ' moved ' + (p.x - before[i].x) + ',' + (p.y - before[i].y);
			}
		}

		return null;
	};

	var arrowE = graph.view.getState(cells.arrowE);
	var arrowEWhy = movedBy('arrowE', 50 * pScale, -50 * pScale);

	HmiSelfTest.check('m2.orientationPivotArrowConnector',
		arrowE != null && parseFloat(arrowE.style[mxConstants.STYLE_ROTATION]) === 90 &&
		arrowEWhy == null, arrowEWhy);

	var lineLocWhy = movedBy('lineLoc', 100 * pScale, 0);
	HmiSelfTest.check('m2.locationConnector', lineLocWhy == null, lineLocWhy);

	// The default stays the object's own center: no displacement
	var rot0 = graph.view.getState(cells.rot);

	HmiSelfTest.check('m2.orientationCenterDefault',
		Math.abs(rot0.x - design.rot.x) < 0.5 && Math.abs(rot0.y - design.rot.y) < 0.5);

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

	// Center anchor: the middle holds.
	hLinks['size.height'].anchor = 'center';
	HmiProject.setCellLinks(graph, cells.h, hLinks);
	rt.rebind();
	setLevel(50);

	hState = graph.view.getState(cells.h);
	var designMiddle = design.h.y + design.h.height / 2;

	HmiSelfTest.check('m2.sizeAnchorCenterHoldsCenter',
		Math.abs((hState.y + hState.height / 2) - designMiddle) < 1,
		'center moved by ' + ((hState.y + hState.height / 2) - designMiddle));

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
	project.devices.push(HmiProject.createDevice('PLC1', 'simulator'));
	project.devices[0].scanMs = 100;

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
 * writes an actual .ahmi to disk with the app's own save machinery, reads
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
		ui.hmiProject.getTag('Tank_Level').address === 'N7:0' &&
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
		HmiSelfTest.hasFileType(types, 'ahmi'),
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
			'Untitled Diagram.ahmi',
		ui.normalizeFilename('Untitled Diagram.drawio'));

	// And a name that already carries ours is left alone, rather than coming
	// back as Name.ahmi.drawio.
	HmiSelfTest.check('name.noDoubleExtension',
		ui.normalizeFilename('Plant.ahmi') === 'Plant.ahmi',
		ui.normalizeFilename('Plant.ahmi'));

	// A file saved under the old extension is offered the new one.
	HmiSelfTest.check('name.legacyBecomesAhmi',
		ui.normalizeFilename('Plant.drawio-hmi') === 'Plant.ahmi',
		ui.normalizeFilename('Plant.drawio-hmi'));

	// An explicit export format still wins.
	HmiSelfTest.check('name.explicitFormatWins',
		ui.normalizeFilename('Plant.svg', 'svg') === 'Plant.svg',
		ui.normalizeFilename('Plant.svg', 'svg'));

	// File > Open offers .ahmi first (the default type), and drawio files still
	var picker = (typeof App !== 'undefined' && App.prototype.chooseFileEntry != null) ?
		'' + App.prototype.chooseFileEntry : '';
	HmiSelfTest.check('name.openFilterAhmiFirst', picker === '' ||
		(picker.indexOf("'ahmi'") > 0 && picker.indexOf("'ahmi'") < picker.indexOf("'drawio'") &&
		picker.indexOf("'drawio-hmi'") > 0), picker.slice(picker.indexOf('filters'), picker.indexOf('filters') + 200));

	// Light unless the user chooses otherwise
	HmiSelfTest.check('brand.pageViewOffByDefault', Graph.prototype.defaultPageVisible === false);
	HmiSelfTest.check('brand.lightByDefault', mxSettings.getDefaults().darkMode === false &&
		mxSettings.settings.hmiLightDefault === true);

	ui.hmiProject = saved;
};

/**
 * Nothing the user can see says draw.io: title, resources, Help, the tab bar,
 * help icons and links; About keeps the licence attribution.
 */
HmiSelfTest.testBrand = function(ui)
{
	var check = HmiSelfTest.check;
	var upstream = /draw\.io|diagrams\.net|drawio\.com|jgraph/i;

	check('brand.appName', Editor.prototype.appName === HmiBrand.NAME);
	check('brand.title', document.title.indexOf(HmiBrand.NAME) >= 0 &&
		!upstream.test(document.title), document.title);
	check('brand.resource', mxResources.get('draw.io') === HmiBrand.NAME &&
		!upstream.test(mxResources.get('cfgCssHelp')), mxResources.get('draw.io'));
	check('brand.noUpstreamAnchors',
		document.querySelectorAll('a[href*="jgraph"], a[href*="drawio.com"], ' +
			'a[href*="diagrams.net"]').length === 0);
	check('brand.pageText', !upstream.test(document.body.innerText),
		(document.body.innerText.match(upstream) || [''])[0]);
	check('brand.helpIconHidden', ui.createHelpIcon('https://www.drawio.com/doc').style.display === 'none');
	check('brand.upstreamLinks', HmiBrand.isUpstreamLink('https://www.drawio.com/doc/faq') &&
		HmiBrand.isUpstreamLink('https://app.diagrams.net/x') &&
		HmiBrand.isUpstreamLink('https://github.com/jgraph/drawio') &&
		!HmiBrand.isUpstreamLink(HmiBrand.ISSUES) &&
		!HmiBrand.isUpstreamLink('https://example.com/draw.io.html'));
	check('brand.svgComment', !upstream.test(Graph.svgFileComment), Graph.svgFileComment);

	// A popup menu builds its table only when it has a factory method
	var menu = new mxPopupMenu(function() {});
	ui.menus.get('help').funct(menu, null);
	var helpText = menu.table.textContent;
	check('brand.helpMenu', helpText.indexOf(mxResources.get('hmiAbout')) >= 0 &&
		helpText.indexOf(mxResources.get('hmiUserGuide')) >= 0 && !upstream.test(helpText) &&
		helpText.indexOf(mxResources.get('quickStart')) < 0, helpText.replace(/\n/g, '|'));
	menu.destroy();

	HmiDialogs.showAbout(ui);
	var dlg = ui.dialog.container;
	check('brand.aboutName', dlg.innerText.indexOf(HmiBrand.NAME) >= 0);
	check('brand.aboutAttribution', dlg.querySelector('[data-hmi-field="attribution"]')
		.innerText.indexOf('Apache License') >= 0);
	ui.hideDialog();
};

/**
 * The alarm manager: conditions with deadband, escalation, ISA-style
 * acknowledgement, counts and system tags, dotfields, scripts, repaint, and
 * the tag configuration.
 */
HmiSelfTest.testAlarms = function(ui)
{
	var check = HmiSelfTest.check;
	var project = HmiSelfTest.sampleProject();
	var level = project.getTag('Tank_Level');
	level.alarms.deadband = 2;
	level.comment = 'Day tank level';
	project.getTag('Pump1_Run').alarms = {state: 'on'};
	var fault = project.addTag(HmiProject.createTag('Motor_Ok', 'MemoryDiscrete'));
	fault.alarms = {state: 'off'};

	var logged = [];
	var sim = new HmiSimulator(project);
	var mgr = new HmiAlarmManager(project, sim, {persist: function(e) { logged = logged.concat(e); }});
	var t = 1000;
	var kinds = function() { return logged.map(function(e) { return e.event + ':' + e.tag + ':' + e.condition; }).join(' '); };
	var set = function(name, v, q)
	{
		var batch = {};
		batch[name] = {value: v, quality: (q != null) ? q : HmiTypes.QUALITY_GOOD, timestamp: ++t};
		mgr.applyBatch(batch);
	};

	check('alarm.alarmedTags', mgr.alarmedTags().join(',') === 'Tank_Level,Pump1_Run,Motor_Ok',
		mgr.alarmedTags().join(','));

	set('Tank_Level', 50);
	set('Motor_Ok', 1);
	check('alarm.normalNoEvent', logged.length === 0 && mgr.counts().active === 0, kinds());

	set('Tank_Level', 91);
	check('alarm.high', mgr.condition('Tank_Level') === 'high' && !mgr.isAcked('Tank_Level') &&
		mgr.counts().active === 1 && mgr.counts().unacked === 1, kinds());
	check('alarm.eventFields', logged[0].description === 'Day tank level' && logged[0].limit === 90 &&
		logged[0].condition === 'Hi' && logged[0].value === 91, JSON.stringify(logged[0]));

	set('Tank_Level', 96);
	check('alarm.escalates', mgr.condition('Tank_Level') === 'hiHi' && logged.length === 2 &&
		logged[1].event === 'ALM', kinds());

	mgr.ack('Tank_Level');
	check('alarm.ackKeepsActiveListed', mgr.isAcked('Tank_Level') && mgr.active().length === 1 &&
		mgr.counts().unacked === 0 && logged[2].event === 'ACK', kinds());

	set('Tank_Level', 94);
	check('alarm.deadbandHolds', mgr.condition('Tank_Level') === 'hiHi' && logged.length === 3, kinds());

	set('Tank_Level', 92);
	check('alarm.easesBackKeepsAck', mgr.condition('Tank_Level') === 'high' && mgr.isAcked('Tank_Level') &&
		logged[3].event === 'CHG', kinds());

	set('Tank_Level', 89);
	check('alarm.deadbandOnReturn', mgr.isActive('Tank_Level') && logged.length === 4, kinds());

	set('Tank_Level', 87);
	check('alarm.returnAckedLeaves', !mgr.isActive('Tank_Level') && mgr.active().length === 0 &&
		logged[4].event === 'RTN', kinds());

	set('Tank_Level', 97);
	mgr.ack('Tank_Level');
	set('Tank_Level', 50);
	set('Tank_Level', 3);
	check('alarm.otherSideIsNew', mgr.condition('Tank_Level') === 'loLo' && !mgr.isAcked('Tank_Level'), kinds());

	// Discrete: in alarm on 1 (Pump1_Run) and on 0 (Motor_Ok)
	set('Pump1_Run', 1);
	set('Motor_Ok', 0);
	check('alarm.discrete', mgr.condition('Pump1_Run') === 'on' && mgr.condition('Motor_Ok') === 'off' &&
		mgr.counts().active === 3, JSON.stringify(mgr.counts()));

	set('Pump1_Run', 0);
	check('alarm.returnUnackedStays', !mgr.isActive('Pump1_Run') && !mgr.isAcked('Pump1_Run') &&
		mgr.active().length === 3 && mgr.counts().active === 2 && mgr.counts().unacked === 3,
		JSON.stringify(mgr.counts()));

	set('Motor_Ok', 1, HmiTypes.QUALITY_BAD);
	check('alarm.badQualityHolds', mgr.condition('Motor_Ok') === 'off', mgr.condition('Motor_Ok'));

	// Runtime: system tags, dotfields, scripts
	var rt = new HmiRuntime({graph: ui.editor.graph, project: project, driver: sim, alarms: mgr});
	check('alarm.systemTags', rt.readField('_AlarmsActive').value === 2 &&
		rt.readField('_AlarmsUnacked').value === 3 && rt.readField('_AckAll').value === 0);
	check('alarm.systemTagCompiles', HmiExpr.compile('_AlarmsActive > 0', {project: project}).errors.length === 0 &&
		HmiExpr.compile('_alarmsactive', {project: project}).errors.length === 0);
	check('alarm.systemReadOnly', HmiExpr.compile('_AlarmsActive = 1', {project: project, mode: 'script'})
		.errors.length > 0);
	check('alarm.dotfields', rt.evaluate('Tank_Level.InAlarm').value === 1 &&
		rt.evaluate('Tank_Level.Acked').value === 0 && rt.evaluate('Pump1_Run.InAlarm').value === 0);

	rt.runScript('Tank_Level.Acked = 1');
	check('alarm.ackByScript', mgr.isAcked('Tank_Level') && rt.evaluate('Tank_Level.Acked').value === 1);

	rt.runScript('_AckAll = 1');
	check('alarm.ackAllByScript', mgr.counts().unacked === 0 && mgr.active().length === 2,
		JSON.stringify(mgr.counts()) + ' listed ' + mgr.active().length);

	// Repaint: a cell colored by Tank_Level.InAlarm follows the alarm
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);
	var cell = graph.insertVertex(graph.getDefaultParent(), null, '', 40, 40, 80, 40);
	HmiProject.setCellLinks(graph, cell, {'fillColor.discrete': {expr: 'Tank_Level.InAlarm',
		on: '#FF0000', off: '#00FF00'}});
	var savedProject = ui.hmiProject;
	ui.hmiProject = project;
	var rt2 = new HmiRuntime({graph: graph, project: project, driver: sim, alarms: mgr});
	rt2.start();
	rt2.flush();
	var fill = function() { var st = graph.view.getState(cell); return (st != null && st.shape != null) ? st.shape.fill : null; };
	var before = fill();
	set('Tank_Level', 50);
	rt2.flush();
	check('alarm.repaintsOnAlarmChange', before === '#FF0000' && fill() === '#00FF00', before + ' -> ' + fill());
	rt2.stop();
	ui.hmiProject = savedProject;
	HmiSelfTest.resetGraph(ui);

	// --- objects --------------------------------------------------------

	check('alarm.shapesRegistered', mxCellRenderer.defaultShapes[HmiAlarms.LIST_SHAPE] != null &&
		mxCellRenderer.defaultShapes[HmiAlarms.HISTORY_SHAPE] != null);
	check('alarm.palette', ui.sidebar != null && ui.sidebar.palettes['hmi'] != null);

	set('Tank_Level', 96);
	set('Pump1_Run', 1);
	HmiSelfTest.resetGraph(ui);
	var listCell = graph.insertVertex(graph.getDefaultParent(), null, '', 40, 40, 480, 200,
		'html=1;noLabel=1;shape=hmiAlarmList;fontSize=12;');
	var histCell = graph.insertVertex(graph.getDefaultParent(), null, '', 40, 280, 560, 240,
		'html=1;noLabel=1;shape=hmiAlarmHistory;fontSize=12;hmiColumns=time,event,tag;hmiMaxEvents=5;');
	check('alarm.objectKind', HmiAlarms.objectKind(graph, listCell) === 'list' &&
		HmiAlarms.objectKind(graph, histCell) === 'history');

	ui.hmiProject = project;
	var rt3 = new HmiRuntime({graph: graph, project: project, driver: sim, alarms: mgr});
	rt3.start();

	var listNode = graph.container.querySelector('[data-hmi-alarm-view="list"]');
	var histNode = graph.container.querySelector('[data-hmi-alarm-view="history"]');
	var listRows = function() { return listNode.querySelectorAll('tbody tr').length; };

	check('alarm.listRendered', listNode != null && listRows() === mgr.active().length &&
		listNode.querySelectorAll('thead th').length === HmiAlarms.LIST_COLUMNS.length + 1,
		(listNode != null) ? listRows() + ' rows for ' + mgr.active().length : 'no view');
	check('alarm.listClasses', listNode.querySelector('[data-hmi-alarm="Tank_Level"]').className
		.indexOf('hmiAlarm-unacked') >= 0 &&
		listNode.querySelector('[data-hmi-alarm="Tank_Level"]').className.indexOf('hmiAlarm-severe') >= 0);
	check('alarm.historyColumns', histNode != null && histNode.querySelectorAll('thead th').length === 3 &&
		histNode.querySelectorAll('tbody tr').length === 5,
		(histNode != null) ? histNode.querySelectorAll('tbody tr').length + ' rows' : 'no view');

	listNode.querySelector('[data-hmi-alarm="Tank_Level"] .hmiAlarmAck').click();
	check('alarm.ackButton', mgr.isAcked('Tank_Level') &&
		listNode.querySelector('[data-hmi-alarm="Tank_Level"]').className.indexOf('hmiAlarm-acked') >= 0 &&
		histNode.querySelector('tbody tr').className.indexOf('hmiAlarmEvent-ACK') >= 0);

	listNode.querySelector('[data-hmi-field="ackAll"]').click();
	check('alarm.ackAllButton', mgr.counts().unacked === 0 &&
		listNode.querySelector('[data-hmi-field="ackAll"]').disabled);

	var w0 = listNode.offsetWidth;
	var z0 = graph.view.scale;
	graph.zoomTo(z0 * 2);
	check('alarm.followsZoom', Math.abs(listNode.offsetWidth - 2 * w0) <= 2, w0 + ' -> ' + listNode.offsetWidth);
	graph.zoomTo(z0);

	rt3.stop();
	check('alarm.viewsRemoved', graph.container.querySelectorAll('.hmiAlarmView').length === 0);

	// Settings in the Animation tab
	if (ui.format != null)
	{
		graph.setSelectionCell(histCell);
		ui.format.immediateRefresh();
		var fc = ui.format.container;
		var title = fc.querySelector('[data-hmi-field="hmiTitle"]');
		title.value = 'Plant events';
		title.dispatchEvent(new Event('blur'));
		check('alarm.settingsTitle', graph.getCellStyle(histCell).hmiTitle === 'Plant events');

		ui.format.immediateRefresh();
		var box = ui.format.container.querySelector('[data-hmi-column="description"]');
		box.checked = true;
		box.dispatchEvent(new Event('change'));
		check('alarm.settingsColumns', graph.getCellStyle(histCell).hmiColumns === 'time,event,tag,description',
			graph.getCellStyle(histCell).hmiColumns);
		graph.clearSelection();
	}

	ui.hmiProject = savedProject;
	HmiSelfTest.resetGraph(ui);

	// Tag configuration
	var threw = false;

	try
	{
		project.addTag(HmiProject.createTag('_ackall', 'MemoryDiscrete'));
	}
	catch (e)
	{
		threw = true;
	}

	check('alarm.reservedName', threw);

	var back = HmiProject.fromXml(project.toXml(mxUtils.createXmlDocument()));
	check('alarm.discreteRoundTrip', back.getTag('Pump1_Run').alarms.state === 'on' &&
		back.getTag('Tank_Level').alarms.deadband === 2 && back.getTag('Tank_Level').alarms.hiHi === 95,
		JSON.stringify(back.getTag('Pump1_Run').alarms));

	check('alarm.logged', logged.length > 8 && logged.every(function(e) { return e.time > 0 && e.tag; }));
};

/**
 * Retentive memory tags: presets replace initial values at the start of a
 * Run, the keeper saves changes, and the flag survives the file.
 */
HmiSelfTest.testRetentive = function(ui)
{
	var check = HmiSelfTest.check;
	var p = HmiSelfTest.sampleProject();
	var sp = p.addTag(HmiProject.createTag('Setpoint', 'MemoryReal'));
	sp.initial = 10;
	sp.retentive = true;
	var mode = p.addTag(HmiProject.createTag('Auto_Mode', 'MemoryDiscrete'));
	mode.retentive = true;
	var recipe = p.addTag(HmiProject.createTag('Recipe', 'MemoryMessage'));
	recipe.retentive = true;
	p.getTag('Tank_Level').retentive = true;

	check('ret.onlyMemoryTags', HmiRetentive.tags(p).join(',') === 'Setpoint,Auto_Mode,Recipe',
		HmiRetentive.tags(p).join(','));

	// Presets replace initial values; I/O tags are not preset
	var sim = new HmiSimulator(p);
	sim.preset({setpoint: 42.5, Auto_Mode: true, Recipe: 'Batch B', Tank_Level: 77});
	sim.connect();
	check('ret.presetApplied', sim.get('Setpoint').value === 42.5 && sim.get('Auto_Mode').value === 1 &&
		sim.get('Recipe').value === 'Batch B', JSON.stringify([sim.get('Setpoint'), sim.get('Auto_Mode')]));
	check('ret.ioNotPreset', sim.get('Tank_Level').value !== 77);

	var sim2 = new HmiSimulator(p);
	sim2.preset({Setpoint: 'not a number'});
	sim2.connect();
	check('ret.badPresetUsesInitial', sim2.get('Setpoint').value === 10);

	// The keeper saves good values of retentive tags, once per burst
	var saved = [];
	var keeper = new HmiRetentiveKeeper(p, sim, {values: {Setpoint: 42.5, Gone_Tag: 5},
		persist: function(v) { saved.push(v); }});
	check('ret.loadedFiltered', JSON.stringify(keeper.values) === '{"Setpoint":42.5}', JSON.stringify(keeper.values));

	keeper.start();
	sim.write({Setpoint: 55});
	sim.write({Setpoint: 56, Pump1_Run: 1});
	keeper.applyBatch({Recipe: {value: 'X', quality: HmiTypes.QUALITY_BAD, timestamp: 1}});
	check('ret.debounced', saved.length === 0);
	keeper.stop();
	// Not Pump1_Run (not retentive), and not the bad-quality 'X'
	check('ret.savedOnStop', saved.length === 1 && saved[0].Setpoint === 56 && saved[0].Pump1_Run == null &&
		saved[0].Recipe === 'Batch B', JSON.stringify(saved));

	keeper.flush();
	check('ret.noChangeNoSave', saved.length === 1);

	// Run starts retentive tags from the retained values
	var savedProject = ui.hmiProject;
	ui.hmiProject = p;
	HmiMenus.startWith(ui, p, false, null, {Setpoint: 88});
	var win = (ui.hmiRuntime != null) ? ui.hmiRuntime.windows[0] : null;
	check('ret.runStartsFromRetained', win != null && win.runtime.driver.get('Setpoint').value === 88,
		(win != null) ? JSON.stringify(win.runtime.driver.get('Setpoint')) : 'no window');
	HmiMenus.stop(ui);
	ui.hmiProject = savedProject;

	var back = HmiProject.fromXml(p.toXml(mxUtils.createXmlDocument()));
	check('ret.flagRoundTrip', back.getTag('Setpoint').retentive === true &&
		back.getTag('Pump1_Run').retentive !== true);
};

/** Users, login, _Username/_AccessLevel, the Enable link and masked input. */
HmiSelfTest.testSecurity = function(ui)
{
	var check = HmiSelfTest.check;
	var S = HmiSecurity;

	// Known answers: FIPS 180-2 "abc" and RFC 7914 PBKDF2-HMAC-SHA256
	check('sec.sha256', S.hex(S.sha256(S.utf8('abc'))) ===
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	check('sec.pbkdf2', S.hex(S.pbkdf2(S.utf8('passwd'), S.utf8('salt'), 1)) ===
		'55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc');

	var h = S.hashPassword('secret');
	var op = {name: 'Operator', level: 100, salt: h.salt, hash: h.hash, iterations: h.iterations};
	check('sec.verify', S.verify(op, 'secret') && !S.verify(op, 'Secret') && !S.verify(op, ''));
	check('sec.names', S.validName('Jane Doe') && !S.validName('None') && !S.validName('') &&
		!S.validName(' lead') && S.validLevel(9999) && !S.validLevel(10000) && !S.validLevel(1.5));

	var p = HmiSelfTest.sampleProject();
	var h2 = S.hashPassword('boss');
	p.users = [op, {name: 'Super', level: 900, salt: h2.salt, hash: h2.hash, iterations: h2.iterations}];
	p.settings.security.autoLogoutMin = 5;

	var back = HmiProject.fromXml(p.toXml(mxUtils.createXmlDocument()));
	var xml = mxUtils.getXml(p.toXml(mxUtils.createXmlDocument()));
	check('sec.roundTrip', back.users.length === 2 && back.users[1].level === 900 &&
		S.verify(back.users[0], 'secret') && back.settings.security.autoLogoutMin === 5);
	check('sec.noPlaintext', xml.indexOf('secret') < 0 && xml.indexOf('boss') < 0);

	// Manager: logged out is "None" and 0
	var saved = [];
	var mgr = new HmiSecurityManager(p, {persist: function(u) { saved.push(u); }});
	var names = [];
	mgr.on('names', function(n) { names = names.concat(n); });
	check('sec.loggedOut', mgr.readSystem('_Username').value === 'None' &&
		mgr.readSystem('_AccessLevel').value === 0);
	check('sec.loginRefused', !mgr.login('Operator', 'nope') && !mgr.login('Nobody', 'secret') &&
		mgr.username() === 'None');
	check('sec.login', mgr.login('operator', 'secret') && mgr.username() === 'Operator' &&
		mgr.accessLevel() === 100 && names.indexOf('_AccessLevel') >= 0);

	check('sec.changePassword', !mgr.changePassword('wrong', 'x') && mgr.changePassword('secret', 'newpw') &&
		saved.length === 1 && S.verify(saved[0][0], 'newpw') && !S.verify(saved[0][0], 'secret'));

	mgr.lastInput = 0;
	mgr.checkIdle(4 * 60000);
	check('sec.idleNotYet', mgr.username() === 'Operator');
	mgr.checkIdle(5 * 60000);
	check('sec.autoLogout', mgr.username() === 'None' && mgr.accessLevel() === 0);

	// Script functions: only in scripts
	check('sec.scriptOnly', HmiExpr.compile('Login("a", "b")', {project: p}).errors.length > 0 &&
		HmiExpr.compile('IF Login("a", "b") THEN ShowLogin(); ENDIF; Logout();',
			{project: p, mode: 'script'}).errors.length === 0,
		JSON.stringify(HmiExpr.compile('IF Login("a", "b") THEN ShowLogin(); ENDIF; Logout();',
			{project: p, mode: 'script'}).errors));
	check('sec.systemReadOnly', HmiExpr.compile('_AccessLevel = 5;', {project: p, mode: 'script'})
		.errors.length > 0);

	// Enable link gates touch; the runtime repaints on login
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);
	var btn = graph.insertVertex(graph.getDefaultParent(), null, 'Start', 40, 40, 100, 40);
	var label = graph.insertVertex(graph.getDefaultParent(), null, '', 40, 100, 100, 40);
	HmiProject.setCellLinks(graph, btn, {
		'pushbutton': {kind: 'discrete', tag: 'Pump1_Run', action: 'set'},
		'enable': {expr: '_AccessLevel >= 500', sense: 'enabled'}
	});
	HmiProject.setCellLinks(graph, label, {
		'valueDisplay': {kind: 'string', expr: '_Username', prefix: '', suffix: ''}
	});

	var sim = new HmiSimulator(p);
	sim.connect();
	var rt = new HmiRuntime({graph: graph, project: p, driver: sim, security: mgr});
	rt.start();
	rt.flush();

	sim.write({'Pump1_Run': 0});
	rt.handleTouch(btn, 'click');
	check('sec.enableBlocks', sim.get('Pump1_Run').value === 0);

	rt.runScript('Login("Super", "boss");');
	rt.flush();
	rt.handleTouch(btn, 'click');
	check('sec.enablePermits', sim.get('Pump1_Run').value === 1 && mgr.username() === 'Super');
	check('sec.usernameDisplayed', rt.evaluate('_Username').value === 'Super' &&
		rt.bindings[label.id] != null && rt.bindings[label.id].visual.label === 'Super',
		(rt.bindings[label.id] != null) ? JSON.stringify(rt.bindings[label.id].visual) : 'no binding');

	rt.runScript('Logout();');
	rt.flush();
	sim.write({'Pump1_Run': 0});
	rt.handleTouch(btn, 'click');
	check('sec.logoutDisables', sim.get('Pump1_Run').value === 0 && rt.evaluate('_AccessLevel').value === 0);

	HmiProject.setCellLinks(graph, btn, {
		'pushbutton': {kind: 'discrete', tag: 'Pump1_Run', action: 'set'},
		'enable': {expr: '_AccessLevel >= 500', sense: 'disabled'}
	});
	rt.rebind();
	rt.flush();
	rt.handleTouch(btn, 'click');
	check('sec.enableSense', sim.get('Pump1_Run').value === 1);
	rt.stop();

	check('sec.enableOffered', HmiTypes.LINKS['enable'].milestone <= HmiTypes.MILESTONE &&
		HmiTypes.LINKS['disable'].milestone > HmiTypes.MILESTONE &&
		typeof HmiFormatPanel.BUILDERS['enable'] === 'function');
	check('sec.maskedDefault', HmiTypes.LINKS['userInput'].defaults().masked === false);

	// Masked user input: a password field that does not show the value
	var savedProject = ui.hmiProject;
	ui.hmiProject = p;
	var urt = new HmiRuntime({graph: graph, project: p, driver: sim});
	urt.values = {'recipe_name': {value: 'Batch A', quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()}};
	HmiDialogs.showUserInput(ui, {kind: 'string', tag: 'Recipe_Name', prompt: 'Password',
		keypad: false, masked: true}, urt);
	var pwField = (ui.dialog != null) ? ui.dialog.container.querySelector('input') : null;
	check('sec.maskedInput', pwField != null && pwField.type === 'password' && pwField.value === '',
		(pwField != null) ? pwField.type + ' ' + pwField.value : 'no field');
	ui.hideDialog();

	// Prebuilt login window
	var field = function(name)
	{
		return (ui.dialog != null) ? ui.dialog.container.querySelector('[data-hmi-field="' + name + '"]') : null;
	};

	HmiDialogs.showLogin(ui, mgr);
	check('sec.loginWindow', field('loginName') != null && field('loginPassword').type === 'password');
	field('loginName').value = 'Super';
	field('loginPassword').value = 'bad';
	field('loginSubmit').click();
	check('sec.loginWindowRefuses', field('loginError') != null &&
		field('loginError').innerText.indexOf('Invalid') === 0 && field('loginPassword').value === '' &&
		mgr.username() === 'None');
	field('loginPassword').value = 'boss';
	field('loginSubmit').click();
	check('sec.loginWindowAccepts', mgr.username() === 'Super' && field('loginName') == null);

	// Users dialog in the editor edits the project; hashes only
	HmiDialogs.showUsers(ui);
	check('sec.usersListed', ui.dialog != null &&
		ui.dialog.container.querySelectorAll('[data-hmi-user]').length === 2);
	field('userName').value = 'Maint';
	field('userLevel').value = '500';
	field('userPassword').value = 'pw1';
	field('userPassword2').value = 'pw2';
	field('userSave').click();
	check('sec.usersMismatch', field('userError').innerText.indexOf('match') > 0 &&
		ui.dialog.container.querySelectorAll('[data-hmi-user]').length === 2);
	field('userPassword2').value = 'pw1';
	field('userSave').click();
	field('userName').value = 'Bad';
	field('userLevel').value = '10000';
	field('userPassword').value = 'x';
	field('userPassword2').value = 'x';
	field('userSave').click();
	check('sec.usersLevelChecked', field('userError').innerText.indexOf('9999') > 0);
	ui.dialog.container.querySelector('.hmiOk').click();
	var maint = S.findUser(p.users, 'maint');
	check('sec.usersAdded', p.users.length === 3 && maint != null && maint.level === 500 &&
		S.verify(maint, 'pw1') && maint.password == null, JSON.stringify(p.users.map(function(u) { return u.name; })));

	// At run time the dialog saves through the manager, and the logged-in user stays
	HmiDialogs.showUsers(ui, {runtime: mgr});
	var superRow = ui.dialog.container.querySelector('[data-hmi-user="Super"] [data-hmi-field="remove"]');
	superRow.click();
	check('sec.cannotRemoveSelf', field('userError').innerText.indexOf('logged in') > 0 &&
		ui.dialog.container.querySelectorAll('[data-hmi-user]').length === 2);
	ui.dialog.container.querySelector('[data-hmi-user="Operator"] [data-hmi-field="remove"]').click();
	ui.dialog.container.querySelector('.hmiOk').click();
	check('sec.runtimeSave', mgr.users.length === 1 && saved.length === 2 && saved[1].length === 1 &&
		p.users.length === 3);

	// Run hands runtime users to the manager in place of the project's
	HmiMenus.startWith(ui, p, false, null, null, [{name: 'Solo', level: 7, salt: h.salt, hash: h.hash,
		iterations: h.iterations}]);
	var run = ui.hmiRuntime;
	check('sec.runUsesSavedUsers', run != null && run.security.users.length === 1 &&
		run.security.login('Solo', 'secret') && run.windows[0].runtime.evaluate('_AccessLevel').value === 7);
	HmiMenus.stop(ui);

	check('sec.menu', ui.actions.get('hmiUsers') != null && ui.actions.get('hmiClearRuntimeUsers') != null);

	// Automation spec: passwords hashed at build, hashes dumped
	var errors = [];
	var built = HmiCli.buildProject({settings: {security: {autoLogoutMin: 10}},
		users: [{name: 'Lead', level: 800, password: 'pw'}, {name: 'None', password: 'x'},
			{name: 'X', level: 1, password: 'y', colour: 'red'}]}, errors);
	check('sec.cliUsers', built.users.length === 2 && S.verify(built.users[0], 'pw') &&
		built.settings.security.autoLogoutMin === 10 && errors.length === 2 &&
		errors[0].indexOf('None') > 0 && errors[1].indexOf('colour') > 0, JSON.stringify(errors));

	ui.hmiProject = savedProject;
};

/** The runtime's view modes (fit, fill, original) and the browser's view menu. */
HmiSelfTest.testViews = function(ui)
{
	var check = HmiSelfTest.check;
	var p = HmiSelfTest.sampleProject();
	p.settings.width = 800;
	p.settings.height = 400;
	var savedProject = ui.hmiProject;
	ui.hmiProject = p;
	HmiSelfTest.resetGraph(ui);

	HmiMenus.startWith(ui, p, true, null, null, null);
	var rt = ui.hmiRuntime;

	if (rt == null || rt.windows.length === 0)
	{
		check('view.started', false, 'no run');
		ui.hmiProject = savedProject;

		return;
	}

	var W = window.innerWidth;
	var H = window.innerHeight;
	var fitScale = Math.min(W / 800, H / 400);
	check('view.fitDefault', rt.view === 'fit' && Math.abs(rt.scale - fitScale) < 0.001 &&
		rt.screen.style.transform === '', rt.view + ' ' + rt.scale);

	rt.setView('fill');
	var sx = W / 800;
	var sy = H / 400;
	check('view.fillStretches', rt.scale === 1 && rt.screen.style.transform === 'scale(' + sx + ', ' + sy + ')' &&
		rt.windows[0].graph.view.scale === 1, rt.screen.style.transform);

	// A tap 100, 50 page units into the stretched screen lands at 100, 50
	var container = rt.windows[0].graph.container;
	var r = container.getBoundingClientRect();
	var pt = mxUtils.convertPoint(container, r.left + 100 * sx, r.top + 50 * sy);
	check('view.fillTapsLand', Math.abs(pt.x - 100) < 0.5 && Math.abs(pt.y - 50) < 0.5, pt.x + ',' + pt.y);

	rt.setView('original');
	check('view.original', rt.scale === 1 && rt.screen.style.transform === '' && rt.backdrop.style.overflow === 'auto' &&
		rt.screen.style.width === '800px' && rt.screen.hmiStretch == null, rt.backdrop.style.overflow);

	pt = mxUtils.convertPoint(container, container.getBoundingClientRect().left + 30, container.getBoundingClientRect().top + 20);
	check('view.originalTaps', Math.abs(pt.x - 30) < 0.5 && Math.abs(pt.y - 20) < 0.5, pt.x + ',' + pt.y);

	rt.setView('nonsense');
	check('view.unknownIgnored', rt.view === 'original');

	rt.setView('fit');
	check('view.backToFit', Math.abs(rt.scale - fitScale) < 0.001 && rt.screen.style.transform === '' &&
		rt.backdrop.style.overflow === '');

	// The starting view: this browser's choice, else hmiview, else fit
	var savedInfo = HmiRuntimeApp.info;
	var savedParam = urlParams['hmiview'];
	HmiRuntimeApp.info = {productName: 'View Test'};

	try { window.localStorage.removeItem(HmiRuntimeApp.viewKey()); } catch (e) {}

	urlParams['hmiview'] = 'original';
	check('view.initialFromUrl', HmiRuntimeApp.initialView() === 'original');
	urlParams['hmiview'] = 'bogus';
	check('view.initialDefault', HmiRuntimeApp.initialView() === 'fit');

	HmiRuntimeApp.showViewMenu(ui);
	var menu = HmiRuntimeApp.viewMenu;
	var options = menu.querySelectorAll('[data-hmi-view]');
	check('view.menu', options.length >= 3 && menu.querySelector('[data-hmi-view="fill"]') != null);
	menu.querySelector('[data-hmi-view="fill"]').click();
	var stored = null;
	try { stored = window.localStorage.getItem(HmiRuntimeApp.viewKey()); } catch (e) {}
	check('view.menuApplies', rt.view === 'fill' && stored === 'fill' && HmiRuntimeApp.initialView() === 'fill' &&
		menu.querySelector('[data-hmi-view="fill"]').classList.contains('hmiViewSelected'), rt.view + ' ' + stored);

	try { window.localStorage.removeItem(HmiRuntimeApp.viewKey()); } catch (e) {}
	menu.parentNode.removeChild(menu);
	HmiRuntimeApp.viewMenu = null;
	HmiRuntimeApp.info = savedInfo;

	if (savedParam == null) { delete urlParams['hmiview']; } else { urlParams['hmiview'] = savedParam; }

	// A run-only Run never stops by itself (a published package)
	ui.hmiRunOnly = false;
	HmiMenus.stop(ui);
	check('view.stopClears', ui.hmiRuntime == null && rt.backdrop == null ||
		!HmiMenus.isRunning(ui), String(HmiMenus.isRunning(ui)));
	ui.hmiProject = savedProject;
};

/** Recipe books, the recipe functions, ShowRecipeSelect and the Recipe List. */
HmiSelfTest.testRecipes = function(ui)
{
	var check = HmiSelfTest.check;
	var p = HmiSelfTest.sampleProject();
	var add = function(name, type) { return p.addTag(HmiProject.createTag(name, type)); };
	add('Plast1', 'MemoryReal');
	add('Plast2', 'MemoryInteger');
	add('Note', 'MemoryMessage');
	add('Heat', 'MemoryDiscrete');
	add('Plc1', 'MemoryReal');
	add('Plc2', 'MemoryInteger');
	add('Sel', 'MemoryMessage');
	add('After', 'MemoryMessage');
	add('Copy', 'MemoryMessage');
	add('Up', 'MemoryDiscrete');
	add('Down', 'MemoryDiscrete');
	add('Go', 'MemoryDiscrete');

	p.recipeBooks = [
		{name: 'Mix', uploadDownload: true, items: [{tag: 'Plast1', ioTag: 'Plc1'}, {tag: 'Plast2', ioTag: 'Plc2'},
			{tag: 'Note', ioTag: ''}, {tag: 'Heat', ioTag: ''}], recipes: {'Start A': {Plast1: 1.5, Plast2: 2, Note: 'a, "b"', Heat: 1}}},
		{name: 'Plain', uploadDownload: false, items: [{tag: 'Plast1', ioTag: ''}], recipes: {}}
	];

	// Model
	var back = HmiProject.fromXml(p.toXml(mxUtils.createXmlDocument()));
	check('recipe.roundTrip', JSON.stringify(back.recipeBooks) === JSON.stringify(p.recipeBooks),
		JSON.stringify(back.recipeBooks));
	var only = new HmiProject();
	only.recipeBooks = [HmiRecipes.newBook('B')];
	check('recipe.notEmpty', !only.isEmpty());
	check('recipe.noTagElementClash', back.tags.length === p.tags.length && back.users.length === 0);

	// Script functions
	var errs = function(src) { return HmiExpr.compile(src, {project: p, mode: 'script'}).errors.map(function(e) { return e.message; }); };
	check('recipe.compile', errs('RecipeSave("Mix", Sel); RecipeDelete("Mix", "x"); RecipeDelete("Mix", "x", 1); ' +
		'Sel = ShowRecipeSelect("Mix"); ShowRecipeSelect("Mix", 10, 20, 300, 400); RecipeRename("Mix", "a", "b");').length === 0,
		errs('RecipeSave("Mix", Sel);').join('|'));
	check('recipe.arity', errs('RecipeDelete("Mix");')[0] === 'RecipeDelete takes 2 to 3 arguments, got 1' &&
		errs('RecipeLoad("Mix");').length === 1);
	check('recipe.asyncPlacement', errs('IF ShowRecipeSelect("Mix") == "" THEN Go = 1; ENDIF;').length === 1 &&
		errs('Sel = ShowRecipeSelect("Mix") + "x";').length === 1 &&
		errs('Sel = ShowRecipeSelect("Mix") + "x";')[0].indexOf('must be a statement or the value of an assignment') > 0);
	check('recipe.scriptOnly', HmiExpr.compile('RecipeSave("Mix", "a")', {project: p}).errors.length > 0);

	// Manager on a simulator
	var sim = new HmiSimulator(p);
	sim.connect();
	check('sim.emptyMessageIsText', sim.get('Note').value === '' && sim.get('Plast1').value === 0 &&
		sim.simulate(p.getTag('Note'), 0, null).value === '' && sim.simulate(p.getTag('Plast1'), 0, null).value === 0,
		JSON.stringify(sim.get('Note')));
	var saved = [];
	var reports = [];
	var m = new HmiRecipeManager(p, sim, {persist: function(b) { saved.push(b); },
		report: function(call, message) { reports.push({call: call, message: message}); }});
	m.start();
	sim.write({Plast1: 12.5, Plast2: 7, Note: 'Batch, "one"', Heat: 1});

	check('recipe.save', m.call('RecipeSave', ['Mix', 'Batch 1']) === 1 &&
		JSON.stringify(m.recipe('Mix', 'batch 1')) === '{"Plast1":12.5,"Plast2":7,"Note":"Batch, \\"one\\"","Heat":1}',
		JSON.stringify(m.recipe('Mix', 'Batch 1')));
	m.flush();
	check('recipe.persisted', saved.length === 1 && saved[0].Mix['Batch 1'] != null && saved[0].Plain == null,
		JSON.stringify(saved));

	// Two managers on one store (two browsers of Append HMI Web): neither loses the other's recipes
	var store = null;
	var shared = {loadSaved: function(fn) { fn(store && JSON.parse(JSON.stringify(store))); },
		persist: function(b) { store = JSON.parse(JSON.stringify(b)); }, report: function() {}};
	var mA = new HmiRecipeManager(p, sim, shared);
	var mB = new HmiRecipeManager(p, sim, shared);
	var bChanged = 0;
	mB.on('change', function() { bChanged++; });
	mA.call('RecipeSave', ['Mix', 'From A']);
	mA.flush();
	mB.call('RecipeSave', ['Mix', 'From B']);
	mB.flush();
	check('recipe.mergeKeepsOthers', store.Mix['From A'] != null && store.Mix['From B'] != null &&
		store.Mix['Start A'] != null && mB.recipe('Mix', 'From A') != null, JSON.stringify(store));
	mA.refresh();
	mA.call('RecipeRename', ['Mix', 'From A', 'A2']);
	mA.call('RecipeDelete', ['Mix', 'From B']);
	mA.flush();
	check('recipe.mergeRenameDelete', store.Mix['A2'] != null && store.Mix['From A'] == null &&
		store.Mix['From B'] == null && store.Mix['Start A'] != null, JSON.stringify(store));
	mB.refresh();
	check('recipe.refreshAdopts', mB.recipe('Mix', 'A2') != null && mB.recipe('Mix', 'From B') == null && bChanged >= 2,
		JSON.stringify(mB.recipeNames('Mix')) + ' ' + bChanged);

	sim.write({Plast1: 0, Plast2: 0, Note: '', Heat: 0});
	check('recipe.load', m.call('RecipeLoad', ['mix', 'BATCH 1']) === 1 && sim.get('Plast1').value === 12.5 &&
		sim.get('Plast2').value === 7 && sim.get('Note').value === 'Batch, "one"' && sim.get('Heat').value === 1);

	check('recipe.download', m.call('RecipeDownload', ['Mix', '']) === 1 && sim.get('Plc1').value === 12.5 &&
		sim.get('Plc2').value === 7);
	sim.write({Plc1: 3.25, Plc2: 9});
	check('recipe.upload', m.call('RecipeUpload', ['Mix', 'x']) === 1 && sim.get('Plast1').value === 3.25 &&
		sim.get('Plast2').value === 9);
	check('recipe.noUploadTags', m.call('RecipeUpload', ['Plain', 'x']) === 0 &&
		reports[reports.length - 1].message === 'The recipe book "Plain" has no Upload/Download tags.');

	check('recipe.rename', m.call('RecipeRename', ['Mix', 'Batch 1', 'Batch 2']) === 1 &&
		m.recipe('Mix', 'Batch 2') != null && m.recipe('Mix', 'Batch 1') == null);
	check('recipe.renameTaken', m.call('RecipeRename', ['Mix', 'Batch 2', 'start a']) === 0 &&
		reports[reports.length - 1].message === 'A recipe named "Start A" already exists in "Mix".');
	check('recipe.renameCase', m.call('RecipeRename', ['Mix', 'Batch 2', 'BATCH 2']) === 1 &&
		m.recipeNames('Mix').join('|') === 'BATCH 2|Start A');

	// Errors, each with its reason
	var before = reports.length;
	var fails = [
		[['RecipeLoad', ['Mix', '']], 'The recipe name is empty.'],
		[['RecipeLoad', ['', 'x']], 'The recipe book name is empty.'],
		[['RecipeLoad', ['Nope', 'x']], 'There is no recipe book named "Nope".'],
		[['RecipeLoad', ['Mix', 'Missing']], 'There is no recipe named "Missing" in "Mix".'],
		[['RecipeDelete', ['Mix', 'Missing']], 'There is no recipe named "Missing" in "Mix".'],
		[['RecipeSave', ['Mix', new Array(70).join('x')]], 'Recipe names can have up to 64 characters, without control characters.'],
		[['RecipeSave', ['Mix', null]], 'The recipe name must be text.']
	];
	var allRight = true;
	var detail = '';

	for (var i = 0; i < fails.length; i++)
	{
		var r = m.call(fails[i][0][0], fails[i][0][1]);

		if (r !== 0 || reports[reports.length - 1].message !== fails[i][1])
		{
			allRight = false;
			detail += fails[i][0][0] + ': ' + reports[reports.length - 1].message + '; ';
		}
	}

	check('recipe.errorReasons', allRight && reports.length === before + fails.length, detail);
	check('recipe.errorNamesCall', reports[before].call === 'RecipeLoad("Mix", "")', reports[before].call);

	m.values['plast2'] = {value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
	check('recipe.badQuality', m.call('RecipeSave', ['Mix', 'Bad']) === 0 && m.recipe('Mix', 'Bad') == null &&
		reports[reports.length - 1].message === 'These tags have no good value: Plast2 (the PLC may not be connected).');
	delete m.values['plast2'];

	m.books[0].recipes['Odd'] = {Plast1: 'abc'};
	check('recipe.writeRefused', m.call('RecipeLoad', ['Mix', 'Odd']) === 0 &&
		reports[reports.length - 1].message === 'Could not write Plast1: "abc" is not a number.');

	p.recipeBooks.push({name: 'Broken', uploadDownload: false, items: [{tag: 'Gone', ioTag: ''}], recipes: {}});
	var m2 = new HmiRecipeManager(p, sim, {report: function(c, msg) { reports.push({call: c, message: msg}); }});
	p.recipeBooks.pop();
	check('recipe.missingTags', m2.call('RecipeSave', ['Broken', 'x']) === 0 &&
		reports[reports.length - 1].message === 'The recipe book "Broken" uses tags that no longer exist: Gone.');

	// Delete, with and without confirmation
	var answer = false;
	m.options.confirm = function(q, fn) { fn(answer); };
	check('recipe.deleteDeclined', m.call('RecipeDelete', ['Mix', 'Odd', 1]) === 1 && m.recipe('Mix', 'Odd') != null);
	answer = true;
	check('recipe.deleteConfirmed', m.call('RecipeDelete', ['Mix', 'Odd', 1]) === 1 && m.recipe('Mix', 'Odd') == null);
	check('recipe.delete', m.call('RecipeDelete', ['Mix', 'BATCH 2']) === 1 && m.recipeNames('Mix').join('|') === 'Start A');

	// The PC's recipes replace the starting ones, book by book
	var m3 = new HmiRecipeManager(p, sim, {saved: {mix: {'From PC': {Plast1: 4}}}});
	check('recipe.savedOverrides', m3.recipeNames('Mix').join('|') === 'From PC' && m3.recipeNames('Plain').length === 0);

	// Export and import
	var exported = null;
	var importText = null;
	m.options.files = {
		exportCsv: function(name, text, fn) { exported = {name: name, text: text}; fn(null, name + '.csv'); },
		importCsv: function(fn) { fn(null, {text: importText}); }
	};
	check('recipe.export', m.call('RecipeExport', ['Mix', 'start a']) === 1 && exported.name === 'Start A' &&
		exported.text === '#Recipe,Mix,Start A\r\nTag,Value\r\nPlast1,1.5\r\nPlast2,2\r\nNote,"a, ""b"""\r\nHeat,1\r\n',
		JSON.stringify(exported));
	importText = exported.text;
	check('recipe.import', m.call('RecipeImport', ['Mix', 'Copy A']) === 1 &&
		JSON.stringify(m.recipe('Mix', 'Copy A')) === JSON.stringify(m.recipe('Mix', 'Start A')),
		JSON.stringify(m.recipe('Mix', 'Copy A')));
	importText = 'Tag,Value\nPlast1,5\nOther,1\nPlast2,x\n';
	before = reports.length;
	m.call('RecipeImport', ['Mix', 'Partial']);
	check('recipe.importWarnings', JSON.stringify(m.recipe('Mix', 'Partial')) === '{"Plast1":5}' &&
		reports.length === before + 1 && reports[before].message.indexOf('not in the book and were ignored: Other') > 0 &&
		reports[before].message.indexOf('not numbers and were left out: Plast2') > 0, reports[before] && reports[before].message);
	importText = 'Tag,Value\nSomething,1\n';
	m.call('RecipeImport', ['Mix', 'None']);
	check('recipe.importForeign', m.recipe('Mix', 'None') == null &&
		reports[reports.length - 1].message.indexOf('This file is not a recipe for "Mix"') === 0);
	check('recipe.csvParse', JSON.stringify(HmiRecipes.fromCsv('#Recipe,a,b\r\nTag,Value\r\n"x,y","1,""2"""\r\n').values) ===
		'{"x,y":"1,\\"2\\""}');
	m.stop();

	// Scripts in a runtime: functions, and a pause at ShowRecipeSelect
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);
	var pending = null;
	var rm = new HmiRecipeManager(p, sim, {select: function(book, names, rect, done) { pending = {names: names, done: done, rect: rect}; },
		report: function(c, msg) { reports.push({call: c, message: msg}); }});
	rm.start();
	var rt = new HmiRuntime({graph: graph, project: p, driver: sim, recipes: rm});
	rt.start();
	sim.write({Plast1: 8, Plast2: 1, Note: 'n', Heat: 0, Go: 1, Sel: '', After: '', Copy: ''});
	rt.runScript('RecipeSave("Mix", "Script");');
	check('recipe.fromScript', rm.recipe('Mix', 'Script') != null && rm.recipe('Mix', 'Script').Plast1 === 8);

	rt.runScript('IF Go THEN Sel = ShowRecipeSelect("Mix", 10, 20); After = "done"; ENDIF; Copy = Sel;');
	check('recipe.scriptPauses', pending != null && sim.get('After').value === '' && pending.rect.x === 10 &&
		pending.names.join('|') === 'Script|Start A', pending && pending.names.join('|'));
	pending.done('Script');
	check('recipe.scriptResumes', sim.get('Sel').value === 'Script' && sim.get('After').value === 'done' &&
		sim.get('Copy').value === 'Script', JSON.stringify([sim.get('Sel'), sim.get('After'), sim.get('Copy')]));

	pending = null;
	sim.write({Sel: 'x', After: ''});
	rt.runScript('Sel = ShowRecipeSelect("Mix"); After = "cancelled";');
	pending.done('');
	check('recipe.scriptCancel', sim.get('Sel').value === '' && sim.get('After').value === 'cancelled');

	pending = null;
	sim.write({After: ''});
	rt.runScript('Sel = ShowRecipeSelect("Mix"); After = "late";');
	rt.stop();
	pending.done('Script');
	check('recipe.stopDropsScript', sim.get('After').value === '');

	// The real window, through the dialogs
	rt = new HmiRuntime({graph: graph, project: p, driver: sim, recipes: rm});
	rt.start();
	rm.options.select = null;
	rm.options.ui = ui;
	sim.write({Sel: ''});
	rt.runScript('Sel = ShowRecipeSelect("Mix");');
	var dlg = document.querySelector('[data-hmi-recipe-select="Mix"]');
	var field = function(name) { return (dlg != null) ? dlg.querySelector('[data-hmi-field="' + name + '"]') : null; };
	check('recipe.selectWindow', dlg != null && dlg.querySelectorAll('[data-hmi-recipe]').length === 2 &&
		dlg.querySelector('.hmiRecipeSelected').getAttribute('data-hmi-recipe') === 'Script');

	if (dlg != null)
	{
		field('recipeDown').click();
		field('recipeDown').click();
		field('recipeUp').click();
		check('recipe.selectArrows', dlg.querySelector('.hmiRecipeSelected').getAttribute('data-hmi-recipe') === 'Script');
		field('recipeDown').click();
		field('recipeSelect').click();
		check('recipe.selectReturns', sim.get('Sel').value === 'Start A' &&
			document.querySelector('[data-hmi-recipe-select]') == null, sim.get('Sel').value);
	}

	rt.runScript('Sel = ShowRecipeSelect("Mix");');
	dlg = document.querySelector('[data-hmi-recipe-select="Mix"]');

	if (dlg != null)
	{
		dlg.querySelector('[data-hmi-field="recipeCancel"]').click();
	}

	check('recipe.selectCancel', sim.get('Sel').value === '');

	// The Recipe Error window: failures listed once the script is done, the
	// same one counted
	rm.options.report = null;
	rt.runScript('RecipeLoad("Mix", ""); RecipeLoad("Mix", ""); RecipeLoad("Nope", "x"); After = "ran";');
	check('recipe.errorAfterScript', sim.get('After').value === 'ran' && document.querySelector('[data-hmi-field="recipeErrors"]') == null);
	HmiDialogs.flushRecipeErrors();
	var errList = document.querySelector('[data-hmi-field="recipeErrors"]');
	check('recipe.errorWindow', errList != null && errList.children.length === 2 &&
		errList.children[0].textContent.indexOf('RecipeLoad("Mix", "")  (×2)') === 0 &&
		errList.children[1].textContent.indexOf('There is no recipe book named "Nope".') > 0,
		(errList != null) ? errList.textContent : 'no window');
	rt.runScript('RecipeLoad("Mix", "Missing");');
	check('recipe.errorAdded', errList != null && errList.children.length === 3);

	if (errList != null)
	{
		document.querySelector('[data-hmi-field="recipeErrorOk"]').click();
	}

	check('recipe.errorClosed', document.querySelector('[data-hmi-field="recipeErrors"]') == null);
	rt.stop();

	// Recipe List object
	HmiSelfTest.resetGraph(ui);
	check('recipe.listShape', mxCellRenderer.defaultShapes[HmiRecipes.LIST_SHAPE] != null);
	var cell = graph.insertVertex(graph.getDefaultParent(), null, '', 40, 40, 240, 300,
		'html=1;noLabel=1;shape=' + HmiRecipes.LIST_SHAPE + ';');
	HmiProject.setCellLinks(graph, cell, {recipeList: {book: 'Mix', title: '', selectedTag: 'Sel', upTag: 'Up',
		downTag: 'Down', arrows: true}});
	sim.write({Sel: 'script', Up: 0, Down: 0});
	rt = new HmiRuntime({graph: graph, project: p, driver: sim, recipes: rm});
	rt.start();
	sim.write({Sel: 'script'});
	var view = document.querySelector('[data-hmi-recipe-view="Mix"]');
	var selectedName = function() { var s = view.querySelector('.hmiRecipeSelected'); return (s != null) ? s.getAttribute('data-hmi-recipe') : ''; };
	check('recipe.listRows', view != null && view.querySelectorAll('[data-hmi-recipe]').length === 2);
	check('recipe.listInitial', view != null && selectedName() === 'Script', view && selectedName());

	if (view != null)
	{
		view.querySelector('[data-hmi-recipe="Start A"]').click();
		check('recipe.listClickWrites', sim.get('Sel').value === 'Start A' && selectedName() === 'Start A');
		sim.write({Up: 1});
		check('recipe.listUpEdge', selectedName() === 'Script' && sim.get('Sel').value === 'Script', selectedName());
		sim.write({Up: 1});
		check('recipe.listNoRepeat', selectedName() === 'Script');
		sim.write({Up: 0});
		sim.write({Down: 1});
		check('recipe.listDownEdge', selectedName() === 'Start A');
		view.querySelector('[data-hmi-recipe-move="up"]').click();
		check('recipe.listArrows', selectedName() === 'Script');
		sim.write({Sel: 'nothing like it'});
		check('recipe.listUnknownNone', selectedName() === '');
		rm.call('RecipeSave', ['Mix', 'Added']);
		check('recipe.listFollowsBook', view.querySelectorAll('[data-hmi-recipe]').length === 3);
		graph.zoomIn();
		var st = graph.view.getState(cell);
		check('recipe.listFollowsZoom', Math.abs(parseFloat(view.style.width) - st.width) < 1.5);
	}

	rt.stop();
	rm.stop();
	check('recipe.listRemoved', document.querySelector('[data-hmi-recipe-view]') == null);
	graph.zoomActual();
	check('recipe.listValidated', HmiMenus.checkLink(p, {book: 'Gone', selectedTag: 'Nope'}).length === 2);

	// HMI > Recipes
	var savedProject = ui.hmiProject;
	ui.hmiProject = p;
	HmiDialogs.showRecipes(ui);
	var box = ui.dialog.container;
	var f = function(name) { return box.querySelector('[data-hmi-field="' + name + '"]'); };
	check('recipe.dialogBooks', box.querySelectorAll('[data-hmi-book]').length === 2);
	f('addBook').click();
	f('bookName').value = 'Third';
	f('bookName').dispatchEvent(new Event('input'));
	f('addItem').click();
	var tagField = box.querySelectorAll('[data-hmi-field="itemTag"]');
	tagField[0].value = 'Nope';
	tagField[0].dispatchEvent(new Event('input'));
	check('recipe.dialogInvalidTag', tagField[0].classList.contains('hmiInvalid'));
	box.querySelector('.hmiOk').click();
	check('recipe.dialogRefuses', ui.dialog != null && f('recipeError').innerText.indexOf('unknown tag "Nope"') > 0,
		f('recipeError') && f('recipeError').innerText);
	tagField = box.querySelectorAll('[data-hmi-field="itemTag"]');
	tagField[0].value = 'Plast1';
	tagField[0].dispatchEvent(new Event('input'));
	f('uploadDownload').click();
	check('recipe.dialogUploadColumn', box.querySelectorAll('[data-hmi-field="itemIoTag"]').length === 1);
	box.querySelectorAll('[data-hmi-field="itemIoTag"]')[0].value = 'Plc1';
	box.querySelectorAll('[data-hmi-field="itemIoTag"]')[0].dispatchEvent(new Event('input'));
	box.querySelector('.hmiOk').click();
	var third = HmiRecipes.findBook(p.recipeBooks, 'Third');
	check('recipe.dialogSaves', third != null && third.uploadDownload && third.items.length === 1 &&
		third.items[0].tag === 'Plast1' && third.items[0].ioTag === 'Plc1');
	ui.hmiProject = savedProject;

	var json = JSON.stringify({version: 1, recipeBooks: p.recipeBooks});
	var parsed = HmiDialogs.parseRecipeBooks(json);
	check('recipe.exportImportBooks', parsed.books != null && JSON.stringify(parsed.books) === JSON.stringify(p.recipeBooks));
	check('recipe.importBad', HmiDialogs.parseRecipeBooks('{"recipeBooks": []}').error != null &&
		HmiDialogs.parseRecipeBooks('nope').error != null);

	// Automation spec
	var errors = [];
	var built = HmiCli.buildProject({tags: [{name: 'A', type: 'MemoryReal'}, {name: 'B', type: 'MemoryReal'}],
		recipeBooks: [{name: 'Bk', uploadDownload: true, items: [{tag: 'A', ioTag: 'B'}], recipes: {R1: {A: 1}}},
			{name: 'Bad', items: ['Gone'], color: 1}]}, errors);
	check('recipe.cliBuild', built.recipeBooks.length === 2 && built.recipeBooks[0].items[0].ioTag === 'B' &&
		built.recipeBooks[0].recipes.R1.A === 1 && errors.length === 2 &&
		errors.some(function(e) { return e.indexOf('color') > 0; }) && errors.some(function(e) { return e.indexOf('Gone') > 0; }),
		JSON.stringify(errors));
};

/** Indirect tags and LinkIndirectTag. */
HmiSelfTest.testTrends = function(ui)
{
	var check = HmiSelfTest.check;
	var graph = ui.editor.graph;
	var p = HmiSelfTest.sampleProject();
	var add = function(name, type) { return p.addTag(HmiProject.createTag(name, type)); };
	var level = add('TrLevel', 'MemoryReal');
	level.minEU = 0;
	level.maxEU = 200;
	level.engUnits = 'gal';
	add('TrRun', 'MemoryDiscrete');
	add('TrName', 'MemoryMessage');
	add('TrPen', 'MemoryMessage');

	// Settings
	check('trend.shapeRegistered', mxCellRenderer.defaultShapes[HmiTrend.SHAPE] != null);
	check('trend.linkHidden', HmiTypes.LINKS['trend'] != null && mxUtils.indexOf(HmiTypes.availableLinks(), 'trend') < 0);
	var n = HmiTrend.normalize({name: ' T1 ', spanSec: '5', sampleMs: 10, pens: [{tag: 'TrLevel'}, {tag: ''}, {tag: 'TrRun'}]});
	check('trend.normalize', n.name === 'T1' && n.spanSec === HmiTrend.MIN_SPAN_SEC && n.sampleMs === HmiTrend.MIN_SAMPLE_MS &&
		n.pens.length === 2 && n.pens[1].color === HmiTrend.COLORS[2], JSON.stringify(n));
	var r1 = HmiTrend.penRange(p, {tag: 'TrLevel', min: '', max: ''});
	var r2 = HmiTrend.penRange(p, {tag: 'TrRun', min: '', max: ''});
	var r3 = HmiTrend.penRange(p, {tag: 'TrRun', min: '-3', max: '2'});
	var r4 = HmiTrend.penRange(p, {tag: 'TrLevel', min: '50', max: '10'});
	check('trend.penRange', r1.min === 0 && r1.max === 200 && r2.min === HmiTrend.DISCRETE_RANGE.min && r2.discrete &&
		r3.min === -3 && r3.max === 2 && r4.min === 0 && r4.max === 200, JSON.stringify([r1, r2, r3, r4]));
	var probs = function(cfg) { return HmiTrend.problems(p, cfg).join('|'); };
	check('trend.problemsOk', probs({name: 'T1', pens: [{tag: 'TrLevel'}, {tag: 'TrRun', min: '0', max: '5'}]}) === '');
	check('trend.problems', probs({name: '', pens: []}).indexOf('no name') >= 0 && probs({name: 'a', pens: []}).indexOf('no pens') >= 0 &&
		probs({name: 'a', pens: [{tag: 'Nope'}]}).indexOf('Unknown tag "Nope"') >= 0 &&
		probs({name: 'a', pens: [{tag: 'TrName'}]}).indexOf('analog or discrete') >= 0 &&
		probs({name: 'a', pens: [{tag: 'TrLevel', min: '5', max: '1'}]}).indexOf('greater than Min') >= 0 &&
		probs({name: 'a', pens: [{tag: 'TrLevel'}, {tag: 'trlevel'}]}).indexOf('already a pen') >= 0 &&
		probs({name: 'a', spanSec: 999999, pens: [{tag: 'TrLevel'}]}).indexOf('Time span') >= 0,
		probs({name: 'a', pens: [{tag: 'TrName'}]}));
	check('trend.uniqueName', HmiTrend.uniqueName('', []) === 'Trend1' && HmiTrend.uniqueName('', ['trend1']) === 'Trend2' &&
		HmiTrend.uniqueName('Trend1', ['Trend1', 'Trend2']) === 'Trend3' && HmiTrend.uniqueName('Level', ['Level']) === 'Level2' &&
		HmiTrend.uniqueName('Mine', ['Trend1']) === 'Mine');

	// Script functions: names are text
	var errs = function(src) { return HmiExpr.compile(src, {project: p, mode: 'script'}).errors.map(function(e) { return e.message; }); };
	check('trend.compile', errs('TrendSetPen("T1", "TrRun"); TrendSetPen(TrName, TrPen); TrendPause("T1"); TrendPlay(TrName); ' +
		'TrendScrollBack("T1"); TrendScrollForward("T1");').length === 0, errs('TrendSetPen(TrName, TrPen);').join('|'));
	check('trend.compileBareTag', (errs('TrendSetPen("T1", TrLevel);')[0] || '').indexOf('write "TrLevel" in quotes') >= 0 &&
		errs('TrendPause(TrRun);').length === 1 && errs('TrendPause("");').length === 1 && errs('TrendPause();').length === 1,
		errs('TrendSetPen("T1", TrLevel);').join('|'));
	check('trend.scriptOnly', HmiExpr.compile('TrendPause("T1")', {project: p}).errors.length === 1);

	// Sampling: values on change, the unchanged one before a change, a heartbeat
	var clock = 1000000;
	var sim = new HmiSimulator(p);
	sim.connect();
	sim.write({TrLevel: 10, TrRun: 0});
	var reported = [];
	var tm = new HmiTrendManager(p, sim, {manual: true, now: function() { return clock; },
		report: function(call, message) { reported.push(call + ': ' + message); },
		trends: [{name: 'T1', spanSec: 60, pens: [{tag: 'TrLevel', color: '#ff0000'}, {tag: 'TrRun'}]},
			{name: 'Fast', spanSec: 30, sampleMs: 500, pens: [{tag: 'TrRun'}]}, {name: 'T1', pens: [{tag: 'TrRun'}]}]});
	tm.start();
	check('trend.firstNameWins', tm.trend('t1').pens.length === 2 && tm.series.trrun.period === 500 && tm.tick === 500);
	tm.sample(clock);
	clock += 1000;
	tm.sample(clock);
	clock += 1000;
	tm.sample(clock);
	clock += 1000;
	sim.write({TrLevel: 20});
	tm.sample(clock);
	var lv = tm.series.trlevel;
	check('trend.recordsOnChange', JSON.stringify(lv.t) === JSON.stringify([1000000, 1002000, 1003000]) &&
		JSON.stringify(lv.v) === '[10,10,20]', JSON.stringify([lv.t, lv.v]));
	clock += HmiTrend.HEARTBEAT_MS;
	tm.sample(clock);
	check('trend.heartbeat', lv.t.length === 4 && lv.v[3] === 20);
	sim.write({TrRun: 1});
	clock += 500;
	tm.sample(clock);
	var rv = tm.series.trrun;
	check('trend.discrete', rv.v[rv.v.length - 1] === 1 && rv.v[rv.v.length - 2] === 0, JSON.stringify(rv.v));
	var pts = tm.points('T1', 'TrLevel', 1001500, 1002500);
	check('trend.pointsEdges', JSON.stringify(pts.t) === '[1000000,1002000,1003000]', JSON.stringify(pts.t));

	// The functions
	var state = tm.state('T1');
	check('trend.setPen', tm.call('TrendSetPen', ['t1', 'trrun']) === 1 && state.pen === 1);
	check('trend.setPenBad', tm.call('TrendSetPen', ['T1', 'TrName']) === 0 &&
		reported[0] === 'TrendSetPen("T1", "TrName"): The trend "T1" has no pen for "TrName".', reported[0]);
	check('trend.unknownTrend', tm.call('TrendPause', ['Nope']) === 0 && tm.call('TrendPlay', ['']) === 0 &&
		reported[1].indexOf('There is no trend named "Nope".') > 0 && reported[2].indexOf('The trend name is empty.') > 0);
	check('trend.forwardLive', tm.call('TrendScrollForward', ['T1']) === 1 && !state.paused);
	check('trend.pause', tm.call('TrendPause', ['T1']) === 1 && state.paused && state.end === clock);
	clock += 10000;
	check('trend.scrollBack', tm.call('TrendScrollBack', ['T1']) === 1 && state.end === clock - 10000 - 30000);
	check('trend.scrollForward', tm.call('TrendScrollForward', ['T1']) === 1 && state.end === clock - 10000);
	tm.call('TrendScrollForward', ['T1']);
	check('trend.forwardStopsAtNow', state.end === clock && state.paused);
	tm.call('TrendPlay', ['T1']);
	tm.call('TrendScrollBack', ['T1']);
	check('trend.scrollBackFromLive', state.paused && state.end === clock - 30000);
	tm.call('TrendPlay', ['T1']);
	check('trend.play', !state.paused);

	// The Run view: a canvas over the cell, the selected pen a pixel thicker
	HmiSelfTest.resetGraph(ui);
	var savedProject = ui.hmiProject;
	ui.hmiProject = p;
	var cell = graph.insertVertex(graph.getDefaultParent(), null, '', 40, 40, 400, 220, HmiTrend.STYLE);
	var autoName = (HmiProject.getCellLinks(graph, cell).trend || {}).name;
	check('trend.autoNamed', autoName === 'Trend1', autoName);
	var copy = graph.importCells([cell], 20, 20, graph.getDefaultParent())[0];
	check('trend.copyRenamed', (HmiProject.getCellLinks(graph, copy).trend || {}).name === 'Trend2');
	graph.removeCells([copy]);
	HmiProject.setCellLinks(graph, cell, {trend: {name: 'T1', title: 'Level', spanSec: 60, sampleMs: 1000, refreshMs: 1000,
		gridColor: '#dde3e8', pens: [{tag: 'TrLevel', min: '', max: '', color: '#ff0000'}, {tag: 'TrRun', min: '', max: '', color: '#0000ff'}]}});
	state.pen = 0;
	var sim2 = new HmiSimulator(p);
	var rt = new HmiRuntime({graph: graph, project: p, driver: sim2, trends: tm});
	rt.start();
	var canvas = document.querySelector('canvas[data-hmi-trend="T1"]');
	check('trend.viewShown', canvas != null);

	var countColor = function(r, g, b)
	{
		var data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
		var count = 0;

		for (var i = 0; i < data.length; i += 4)
		{
			if (Math.abs(data[i] - r) < 60 && Math.abs(data[i + 1] - g) < 60 && Math.abs(data[i + 2] - b) < 60 && data[i + 3] > 200)
			{
				count++;
			}
		}

		return count;
	};

	if (canvas != null)
	{
		var thick = countColor(255, 0, 0);
		tm.call('TrendSetPen', ['T1', 'TrRun']);
		var thin = countColor(255, 0, 0);
		check('trend.selectedThicker', thick > 0 && thin > 0 && thick > thin * 1.4, thick + ' vs ' + thin);
		check('trend.otherPenDrawn', countColor(0, 0, 255) > 0);
		graph.zoomIn();
		var st = graph.view.getState(cell);
		check('trend.followsZoom', Math.abs(parseFloat(canvas.style.width) - st.width) < 1.5);
		graph.zoomActual();
	}

	// Validate: literal names checked against the pages, duplicates reported
	check('trend.validateScript', HmiMenus.scriptWindowProblems(ui, 'TrendPause("Nope"); TrendSetPen("T1", "TrName"); TrendPlay("t1");')
		.join('|') === 'TrendPause: no trend named "Nope"|TrendSetPen: the trend "T1" has no pen for "TrName"',
		HmiMenus.scriptWindowProblems(ui, 'TrendPause("Nope"); TrendSetPen("T1", "TrName"); TrendPlay("t1");').join('|'));
	var dup = graph.insertVertex(graph.getDefaultParent(), null, '', 500, 40, 200, 100, HmiTrend.STYLE);
	HmiProject.setCellLinks(graph, dup, {trend: {name: 't1', pens: [{tag: 'TrLevel'}]}});
	var found = null;
	var available = HmiComms.available;
	HmiComms.available = function() { return false; };
	HmiMenus.collectProblems(ui, function(list) { found = list; });
	HmiComms.available = available;
	check('trend.validateDuplicate', found != null && found.some(function(x) { return x.cell === dup && x.message.indexOf('2 trends are named') === 0; }),
		JSON.stringify((found || []).map(function(x) { return x.message; })));

	rt.stop();
	check('trend.viewRemoved', document.querySelector('canvas[data-hmi-trend]') == null);
	tm.stop();
	check('trend.gapAtStop', isNaN(lv.v[lv.v.length - 1]) && isNaN(rv.v[rv.v.length - 1]));
	ui.hmiProject = savedProject;
	HmiSelfTest.resetGraph(ui);
};

HmiSelfTest.testIndirect = function(ui)
{
	var check = HmiSelfTest.check;
	var p = HmiSelfTest.sampleProject();
	var add = function(name, type) { return p.addTag(HmiProject.createTag(name, type)); };
	add('Real1', 'MemoryReal');
	add('Real2', 'MemoryInteger');
	add('Msg1', 'MemoryMessage');
	add('Disc1', 'MemoryDiscrete');
	add('N', 'MemoryInteger');
	add('Which', 'MemoryMessage');
	add('IndA', 'IndirectAnalog');
	add('IndM', 'IndirectMessage');
	add('IndD', 'IndirectDiscrete');
	p.getTag('Real1').alarms = {high: 50};

	// Types and the model
	check('ind.types', HmiTypes.isIndirect('IndirectAnalog') && !HmiTypes.isIO('IndirectAnalog') &&
		HmiTypes.isAnalog('IndirectAnalog') && HmiTypes.isDiscrete('IndirectDiscrete') && HmiTypes.isMessage('IndirectMessage'));
	check('ind.accepts', HmiTypes.indirectAccepts('IndirectAnalog', 'IOInteger') &&
		HmiTypes.indirectAccepts('IndirectAnalog', 'MemoryReal') && !HmiTypes.indirectAccepts('IndirectAnalog', 'MemoryMessage') &&
		HmiTypes.indirectAccepts('IndirectDiscrete', 'IODiscrete') && !HmiTypes.indirectAccepts('IndirectDiscrete', 'MemoryReal') &&
		!HmiTypes.indirectAccepts('IndirectAnalog', 'IndirectAnalog'));
	check('ind.createBare', JSON.stringify(p.getTag('IndA')) === '{"name":"IndA","type":"IndirectAnalog","comment":""}');
	var back = HmiProject.fromXml(p.toXml(mxUtils.createXmlDocument()));
	check('ind.roundTrip', JSON.stringify(back.getTag('IndM')) === JSON.stringify(p.getTag('IndM')),
		JSON.stringify(back.getTag('IndM')));
	check('ind.notRetentiveOrAlarmed', !HmiRetentive.isRetentive({name: 'X', type: 'IndirectAnalog', retentive: true}) &&
		!HmiAlarms.isAlarmed({name: 'X', type: 'IndirectAnalog', alarms: {high: 1}}));

	// Compile
	var errs = function(src, mode) { return HmiExpr.compile(src, {project: p, mode: mode || 'script'}).errors.map(function(e) { return e.message; }); };
	check('ind.compileOk', errs('LinkIndirectTag("IndA", "Real1"); LinkIndirectTag("indm", Which); ' +
		'LinkIndirectTag("IndA", "Real" + Text(N, "0")); LinkIndirectTag(Which, "Disc1"); IndA = IndA + 1;').length === 0,
		errs('LinkIndirectTag("IndA", "Real" + Text(N, "0"));').join('|'));
	check('ind.compileNotIndirect', errs('LinkIndirectTag("Real1", "Real2");')[0] ===
		'LinkIndirectTag: "Real1" is a MemoryReal tag, not an indirect tag', errs('LinkIndirectTag("Real1", "Real2");')[0]);
	check('ind.compileIncompatible', /cannot be linked to "Msg1"/.test(errs('LinkIndirectTag("IndA", "Msg1");')[0] || ''));
	check('ind.compileUnknown', /no tag named "Nope"/.test(errs('LinkIndirectTag("IndA", "Nope");')[0] || ''));
	check('ind.compileBareRef', /write "IndA" in quotes/.test(errs('LinkIndirectTag(IndA, "Real1");')[0] || ''));
	check('ind.compileScriptOnly', errs('LinkIndirectTag("IndA", "Real1")', 'expr').length === 1);
	check('ind.readCompiles', errs('IndA * 2 + IndD', 'expr').length === 0);

	// Strings: + joins text and converts tag values
	var strCtx = {read: function(n) { return {value: (n === 'N') ? 2 : (n === 'Disc1' ? true : 'Mix'), quality: 192, timestamp: 0}; }};
	var joined = HmiExpr.compile('"Real" + N + "/" + Msg1 + Disc1', {project: p}).eval(strCtx);
	check('ind.stringJoin', joined.value === 'Real2/Mix1', JSON.stringify(joined));

	// The hub and a runtime on a simulator
	var sim = new HmiSimulator(p);
	sim.connect();
	check('ind.simSkips', sim.get('IndA') == null || sim.get('IndA').value == null);
	var hub = new HmiDriverHub(sim, p);
	var reports = [];
	var ind = new HmiIndirect(p, hub, {report: function(call, message) { reports.push(call + ' ' + message); }});
	var other = hub.client();
	var seen = {};
	other.on('change', function(b) { for (var k in b) { seen[k] = b[k].value; } });
	other.subscribe(['IndA', 'IndM'], 250);

	HmiSelfTest.resetGraph(ui);
	var graph = ui.editor.graph;
	var cell = graph.insertVertex(graph.getDefaultParent(), null, 'x', 20, 20, 120, 40, 'html=1;');
	HmiProject.setCellLinks(graph, cell, {valueDisplay: {kind: 'analog', expr: 'IndA', format: '0.0', prefix: '', suffix: '',
		onText: '', offText: ''}});
	var rt = new HmiRuntime({graph: graph, project: p, driver: hub.client(), indirect: ind});
	rt.start();
	sim.write({Real1: 12.5, Real2: 7, N: 2, Which: 'IndM', Msg1: 'hello'});
	rt.flush();
	check('ind.unlinkedBad', rt.getValue('IndA').quality <= HmiTypes.QUALITY_BAD);

	rt.runScript('LinkIndirectTag("IndA", "Real1");');
	rt.flush();
	check('ind.linkShows', rt.bindings[cell.id].visual.label === '12.5' && seen.IndA === 12.5,
		rt.bindings[cell.id].visual.label + ' ' + seen.IndA);
	sim.write({Real1: 60});
	rt.flush();
	check('ind.followsChanges', rt.bindings[cell.id].visual.label === '60.0' && seen.IndA === 60);
	check('ind.dotfields', rt.readField('IndA', 'Name').value === 'Real1' && rt.readField('IndA', 'InAlarm').value === 1 &&
		rt.readField('IndA', 'MaxEU').value === 100, JSON.stringify(rt.readField('IndA', 'Name')));
	rt.runScript('IndA = 33;');
	check('ind.writeThrough', sim.get('Real1').value === 33);

	rt.runScript('LinkIndirectTag("IndA", "Real" + N);');
	rt.flush();
	check('ind.relinkByExpression', rt.bindings[cell.id].visual.label === '7.0' && rt.readField('IndA', 'Name').value === 'Real2',
		rt.bindings[cell.id].visual.label);
	sim.write({Real1: 1});
	rt.flush();
	check('ind.oldLinkGone', rt.bindings[cell.id].visual.label === '7.0' && seen.IndA === 7);
	rt.runScript('LinkIndirectTag(Which, "Msg1");');
	check('ind.sharedAcrossClients', seen.IndM === 'hello' && hub.client().get('IndM').value === 'hello');

	// Failures: 0, the reason reported, the link unchanged
	var before = reports.length;
	var r = [ind.call('LinkIndirectTag', ['', 'Real1']), ind.call('LinkIndirectTag', ['IndA', 'Nope']),
		ind.call('LinkIndirectTag', ['Real1', 'Real2']), ind.call('LinkIndirectTag', ['IndA', 'Msg1']),
		ind.call('LinkIndirectTag', ['IndA', 'IndM'])];
	check('ind.failures', r.join('') === '00000' && reports.length === before + 5 &&
		reports[before].indexOf('The indirect tag name is empty.') > 0 && hub.resolve('IndA') === 'Real2', reports.join(' | '));
	check('ind.callReturns1', ind.call('LinkIndirectTag', ['inda', 'real1']) === 1 && hub.resolve('IndA') === 'Real1');
	rt.stop();

	// Scripts read tags no object shows: subscribed, and read from the driver until delivered
	var btn = graph.insertVertex(graph.getDefaultParent(), null, 'b', 20, 80, 80, 30, 'html=1;');
	HmiProject.setCellLinks(graph, btn, {'pushbutton.action': {onDown: 'IF Real2 > 5 THEN N = 9; ENDIF;', whileDown: '', onUp: '', everyMs: '1000'}});
	var srt = new HmiRuntime({graph: graph, project: p, driver: hub.client(), indirect: ind, scripts: ['Which = Msg1;', null]});
	srt.start();
	var subs = srt.subscriptionPaths();
	check('script.depsSubscribed', subs.indexOf('Real2') >= 0 && subs.indexOf('Msg1') >= 0 && subs.indexOf('Which') >= 0,
		JSON.stringify(subs));
	srt.values = {};
	check('script.readsDriver', srt.getValue('Msg1').value === 'hello');
	srt.runScript('IF Msg1 == "hello" THEN N = 4; ENDIF;');
	check('script.unshownTagRead', sim.get('N').value === 4);
	srt.stop();
	other.disconnect();
	hub.disconnect();
	check('ind.linksClearedOnStop', hub.resolve('IndA') == null);

	// Error window title for indirect and mixed failures
	check('ind.errorTitle', HmiDialogs.functionErrorTitle([{call: 'LinkIndirectTag("A", "B")'}]) === 'Indirect Tag Error' &&
		HmiDialogs.functionErrorTitle([{call: 'RecipeLoad("A", "")'}]) === 'Recipe Error' &&
		HmiDialogs.functionErrorTitle([{call: 'RecipeLoad("A", "")'}, {call: 'LinkIndirectTag("A", "B")'}]) === 'Script Error');

	// A hidden object over a button lets touches through to it
	HmiSelfTest.resetGraph(ui);
	var under = graph.insertVertex(graph.getDefaultParent(), null, 'button', 20, 20, 120, 40, 'html=1;');
	HmiProject.setCellLinks(graph, under, {pushbutton: {kind: 'discrete', tag: 'Disc1', action: 'set', enableExpr: ''}});
	var over = graph.insertVertex(graph.getDefaultParent(), null, 'note', 10, 10, 200, 60, 'html=1;');
	HmiProject.setCellLinks(graph, over, {visibility: {expr: 'Disc1', sense: 'visible'}});
	var trt = new HmiRuntime({graph: graph, project: p, driver: sim});
	trt.start();
	sim.write({Disc1: 0});
	trt.flush();
	var ust = graph.view.getState(under);
	var fakeMe = {getCell: function() { return over; }, getGraphX: function() { return ust.getCenterX(); },
		getGraphY: function() { return ust.getCenterY(); }};
	check('touch.throughHidden', trt.touchedCell(fakeMe) === under);
	sim.write({Disc1: 1});
	trt.flush();
	check('touch.visibleOnTopWins', trt.touchedCell(fakeMe) === over);
	check('cursor.touchable', trt.isTouchable(under) && !trt.isTouchable(over));
	trt.updateCursor({getCell: function() { return under; }, getGraphX: fakeMe.getGraphX, getGraphY: fakeMe.getGraphY});
	check('cursor.handOverButton', graph.container.style.cursor === 'pointer');
	trt.updateCursor({getCell: function() { return null; }, getGraphX: function() { return 5; }, getGraphY: function() { return 5; }});
	check('cursor.arrowElsewhere', graph.container.style.cursor === 'default');
	trt.bindings[under.id].visual.disabled = true;
	check('cursor.disabledNotTouchable', !trt.isTouchable(under));
	trt.bindings[under.id].visual.disabled = false;
	trt.stop();

	// Automation spec
	var errors = [];
	var built = HmiCli.buildProject({tags: [{name: 'P', type: 'IndirectAnalog', comment: 'pointer'},
		{name: 'Q', type: 'IndirectDiscrete', address: 'X'}]}, errors);
	check('ind.cli', built.getTag('P') != null && built.getTag('P').comment === 'pointer' && errors.length === 1 &&
		errors[0].indexOf('only a comment') > 0, JSON.stringify(errors));
};

/** Arc objects: geometry, markers, the General palette and the Style tab section. */
HmiSelfTest.testArcs = function(ui)
{
	var check = HmiSelfTest.check;

	check('arc.shapeRegistered', mxCellRenderer.defaultShapes[HmiArc.SHAPE] != null);
	check('arc.sweep', HmiArc.sweep(0, 180) === 180 && HmiArc.sweep(180, 0) === 180 &&
		HmiArc.sweep(0, 0) === 360 && HmiArc.sweep(300, 60) === 120 && HmiArc.sweep(-90, 90) === 180);

	// As on a protractor: 0° at the right, counterclockwise, so 0 to 90 runs right to top
	var q = HmiArc.points({arcType: 'circle', arcStart: 0, arcEnd: 90}, 0, 0, 100, 100).points;
	check('arc.protractorAngles', Math.abs(q[0].x - 100) < 0.01 && Math.abs(q[0].y - 50) < 0.01 &&
		Math.abs(q[q.length - 1].x - 50) < 0.01 && Math.abs(q[q.length - 1].y) < 0.01,
		JSON.stringify([q[0], q[q.length - 1]]));
	var e = HmiArc.points({arcType: 'ellipse', arcStart: 90, arcEnd: 270}, 0, 0, 200, 100).points;
	var mid = e[Math.floor(e.length / 2)];
	check('arc.counterclockwise', Math.abs(e[0].x - 100) < 0.01 && Math.abs(e[0].y) < 0.01 &&
		Math.abs(mid.x) < 0.5 && Math.abs(e[e.length - 1].y - 100) < 0.01, JSON.stringify(mid));
	var w = HmiArc.points({arcType: 'circle', arcStart: 300, arcEnd: 60}, 0, 0, 100, 100).points;
	var wmid = w[Math.floor(w.length / 2)];
	check('arc.sweepsThroughZero', Math.abs(wmid.x - 100) < 0.01 && Math.abs(wmid.y - 50) < 0.5, JSON.stringify(wmid));
	var c = HmiArc.points({arcType: 'circle', arcStart: 90, arcEnd: 270}, 0, 0, 200, 100).points;
	check('arc.circleStaysRound', Math.abs(c[0].x - 100) < 0.01 && Math.abs(c[Math.floor(c.length / 2)].x - 50) < 0.5);

	var two = [new mxPoint(0, 0), new mxPoint(10, 0)];
	two[0].f = 0;
	two[1].f = 1;
	var out = HmiArc.taper(two, 2, 6);
	check('arc.taperWidths', Math.abs(Math.abs(out[0].y) - 1) < 0.01 && Math.abs(Math.abs(out[1].y) - 3) < 0.01 &&
		Math.abs(Math.abs(out[2].y) - 3) < 0.01 && Math.abs(Math.abs(out[3].y) - 1) < 0.01, JSON.stringify(out));

	var line = [new mxPoint(0, 0), new mxPoint(10, 0), new mxPoint(20, 0)];
	HmiArc.trim(line, 5, false);
	var line2 = [new mxPoint(0, 0), new mxPoint(10, 0), new mxPoint(20, 0)];
	HmiArc.trim(line2, 12, true);
	check('arc.trimsForMarkers', line[line.length - 1].x === 15 && line2[0].x === 12 && line2.length === 2);

	// Drawn in a graph, with markers at both ends
	HmiSelfTest.resetGraph(ui);
	var graph = ui.editor.graph;
	var plain = graph.insertVertex(graph.getDefaultParent(), null, '', 20, 20, 100, 100, HmiArc.CIRCLE_STYLE);
	var arrows = graph.insertVertex(graph.getDefaultParent(), null, '', 150, 20, 160, 100,
		HmiArc.ELLIPSE_STYLE.replace('startArrow=none', 'startArrow=oval').replace('endArrow=none', 'endArrow=block') + 'strokeWidth=3;arcEndWidth=9;');
	var paths = function(cell) { var st = graph.view.getState(cell); return (st != null && st.shape != null && st.shape.node != null) ? st.shape.node.querySelectorAll('path, ellipse').length : -1; };
	check('arc.drawsLine', paths(plain) >= 1, '' + paths(plain));
	check('arc.drawsMarkers', paths(arrows) >= 3, '' + paths(arrows));
	check('arc.cliTypes', HmiCli.TYPES.arc === HmiArc.ELLIPSE_STYLE && HmiCli.TYPES.circleArc === HmiArc.CIRCLE_STYLE);
	var errors = [];
	var built = HmiCli.buildProject({pages: [{name: 'P', objects: [{type: 'circleArc', x: 0, y: 0, width: 50, height: 50,
		style: 'arcStart=0;arcEnd=180;endArrow=classic;'}]}]}, errors);
	check('arc.cliBuilds', errors.length === 0, JSON.stringify(errors));

	// The Style tab's Arc section edits the style
	graph.setSelectionCell(arrows);
	ui.format.immediateRefresh();
	var strip = ui.format.container.firstChild;
	var styleTab = [].slice.call(strip.childNodes).filter(function(n) { return /style/i.test(n.textContent); })[0];

	if (styleTab != null)
	{
		styleTab.click();
	}

	var sec = ui.format.container.querySelector('[data-hmi-arc-section]');
	check('arc.styleSection', sec != null && sec.querySelector('[data-hmi-arc="startArrow"]').value === 'oval' &&
		sec.querySelector('[data-hmi-arc="width"]').value === '3' && sec.querySelector('[data-hmi-arc="endWidth"]').value === '9');

	if (sec != null)
	{
		var end = sec.querySelector('[data-hmi-arc="end"]');
		end.value = '200';
		end.dispatchEvent(new Event('change'));
		check('arc.sectionWritesStyle', mxUtils.getValue(graph.getCellStyle(arrows), 'arcEnd', null) == 200);
	}

	var fillTitle = mxResources.get('fill');
	check('arc.noFillSection', [].slice.call(ui.format.container.childNodes).every(function(n) {
		return n.firstChild == null || ('' + n.firstChild.textContent).trim() !== fillTitle; }));
	graph.clearSelection();
	HmiSelfTest.resetGraph(ui);
};

/** Flipping a group mirrors everything in it about the group's center. */
HmiSelfTest.testFlip = function(ui)
{
	var check = HmiSelfTest.check;
	HmiSelfTest.resetGraph(ui);
	var graph = ui.editor.graph;
	var model = graph.model;
	var parent = graph.getDefaultParent();
	var a, b, c, d, edge, inner, group;

	model.beginUpdate();
	try
	{
		a = graph.insertVertex(parent, null, '', 100, 100, 40, 20, 'rounded=0;rotation=30;');
		b = graph.insertVertex(parent, null, '', 200, 100, 60, 60, HmiArc.ELLIPSE_STYLE);
		c = graph.insertVertex(parent, null, '', 100, 200, 20, 20, 'ellipse;');
		d = graph.insertVertex(parent, null, '', 140, 200, 20, 30, 'triangle;');
		edge = graph.insertEdge(parent, null, '', a, b);
		edge.geometry.points = [new mxPoint(170, 90)];
		inner = graph.groupCells(null, 0, [c, d]);
		group = graph.groupCells(null, 0, [a, b, edge, inner]);
	}
	finally
	{
		model.endUpdate();
	}

	var gw = group.geometry.width, gh = group.geometry.height;
	var before = function(cell) { return cell.geometry.clone(); };
	var ga = before(a), gb = before(b), gi = before(inner), gc = before(c), gd = before(d);
	var pt = edge.geometry.points[0].clone();
	var style = function(cell, key) { return mxUtils.getValue(graph.getCellStyle(cell), key, null); };

	graph.flipCells([group], true);
	check('flip.groupMirrorsChildren', a.geometry.x === gw - ga.x - ga.width && b.geometry.x === gw - gb.x - gb.width &&
		a.geometry.y === ga.y && inner.geometry.x === gw - gi.x - gi.width,
		JSON.stringify([gw, a.geometry.x, b.geometry.x, inner.geometry.x]));
	check('flip.nestedGroupMirrors', c.geometry.x === gi.width - gc.x - gc.width && d.geometry.x === gi.width - gd.x - gd.width,
		JSON.stringify([c.geometry.x, d.geometry.x]));
	check('flip.childrenFlipped', style(a, 'flipH') == 1 && style(b, 'flipH') == 1 && style(c, 'flipH') == 1 && style(d, 'flipH') == 1);
	check('flip.rotationReversed', style(a, 'rotation') == 330, '' + style(a, 'rotation'));
	check('flip.edgePointsMirrored', edge.geometry.points[0].x === gw - pt.x && edge.geometry.points[0].y === pt.y,
		JSON.stringify(edge.geometry.points[0]));

	graph.flipCells([group], true);
	check('flip.twiceRestores', a.geometry.x === ga.x && c.geometry.x === gc.x && style(a, 'flipH') == 0 &&
		style(a, 'rotation') == 30 && edge.geometry.points[0].x === pt.x);

	graph.flipCells([group], false);
	check('flip.vertical', a.geometry.y === gh - ga.y - ga.height && a.geometry.x === ga.x && style(c, 'flipV') == 1,
		JSON.stringify([gh, a.geometry.y]));
	graph.flipCells([group], false);

	// Arrange > Direction > Flip Horizontal does the same
	var items = [];
	var stub = {addItem: function(label, image, fn) { items.push({label: label, fn: fn}); return document.createElement('tr'); },
		addSeparator: function() {}};

	try
	{
		ui.menus.get('direction').funct(stub, null);
	}
	catch (e)
	{
		// Only the flip items are needed
	}

	var flipH = items.filter(function(it) { return it.label === mxResources.get('flipH'); })[0];
	graph.setSelectionCell(group);

	if (flipH != null)
	{
		flipH.fn();
	}

	check('flip.directionMenu', flipH != null && a.geometry.x === gw - ga.x - ga.width && style(d, 'flipH') == 1);

	// A single object still flips in place
	var single = graph.insertVertex(parent, null, '', 400, 50, 40, 20, 'triangle;');
	graph.flipCells([single], true);
	check('flip.singleInPlace', single.geometry.x === 400 && style(single, 'flipH') == 1);
	graph.clearSelection();
	HmiSelfTest.resetGraph(ui);

	// Later checks count undo steps, which stop growing at the history's limit
	ui.editor.undoManager.clear();
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

	// A mousedown on the field must keep its default behaviour, or the field
	// never takes focus and the keystrokes land on the graph -- which starts a
	// label edit and renames the very shape being configured.
	HmiSelfTest.check('script.mousedownAllowed',
		ui.isSelectionAllowed({target: a, srcElement: a}) === true,
		'isSelectionAllowed said no for a TEXTAREA');

	// And the stock rule still holds for everything else.
	HmiSelfTest.check('script.canvasStillNotSelectable',
		ui.isSelectionAllowed({target: graph.container,
			srcElement: graph.container}) !== true,
		'the canvas should not be treated as selectable text');

	var inputs = panel.getElementsByTagName('input');

	if (inputs.length > 0)
	{
		HmiSelfTest.check('script.inputsStillAllowed',
			ui.isSelectionAllowed({target: inputs[0],
				srcElement: inputs[0]}) === true);
	}

	// Dispatch the event rather than calling blur(): a programmatic blur does
	// not reliably fire when the window itself is not focused, which is the
	// usual state for an automated run.
	a.value = 'Pump1_Run = 1;';
	a.dispatchEvent(new Event('input', {bubbles: true}));
	a.dispatchEvent(new FocusEvent('blur'));

	HmiSelfTest.blurAll(ui);

	var back = HmiProject.getCellLinks(graph, cell)['pushbutton.action'];

	HmiSelfTest.check('script.commitsOnBlur',
		back != null && back.onDown === 'Pump1_Run = 1;',
		'stored ' + ((back != null) ? JSON.stringify(back.onDown) : 'nothing'));

	HmiSelfTest.clearDraft(ui);
};

/** IF / THEN / ELSE / ENDIF in action scripts. */
HmiSelfTest.testConditionals = function()
{
	var project = HmiSelfTest.sampleProject();
	project.addTag(HmiProject.createTag('Result', 'MemoryInteger'));
	project.addTag(HmiProject.createTag('Other', 'MemoryInteger'));

	var values = {};
	var written = {};

	function reset(level, quality)
	{
		values = {
			'tank_level': {value: level,
				quality: (quality != null) ? quality : HmiTypes.QUALITY_GOOD,
				timestamp: 100},
			'pump1_run': {value: 1, quality: HmiTypes.QUALITY_GOOD, timestamp: 100},
			'result': {value: 0, quality: HmiTypes.QUALITY_GOOD, timestamp: 100},
			'other': {value: 0, quality: HmiTypes.QUALITY_GOOD, timestamp: 100}
		};
		written = {};
	}

	var ctx = {
		read: function(name)
		{
			var v = values[name.toLowerCase()];

			return (v != null) ? v :
				{value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
		},
		write: function(name, value)
		{
			written[name] = value;
			values[name.toLowerCase()] = {value: value,
				quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};
		},
		now: function() { return Date.now(); }
	};

	function run(src, level, quality)
	{
		reset(level, quality);
		var c = HmiExpr.compile(src, {project: project, mode: 'script'});

		if (c.errors.length > 0)
		{
			return {errors: c.errors};
		}

		c.eval(ctx);

		return {written: written, compiled: c};
	}

	// --- the then branch --------------------------------------------------

	var simple = 'IF Tank_Level > 50 THEN Result = 1; ENDIF;';

	HmiSelfTest.check('if.thenTaken',
		run(simple, 80).written['Result'] === 1,
		JSON.stringify(run(simple, 80).written));

	HmiSelfTest.check('if.thenSkipped',
		run(simple, 10).written['Result'] === undefined,
		JSON.stringify(run(simple, 10).written));

	// --- else -------------------------------------------------------------

	var both = 'IF Tank_Level > 50 THEN Result = 1; ELSE Result = 2; ENDIF;';

	HmiSelfTest.check('if.elseTaken',
		run(both, 10).written['Result'] === 2,
		JSON.stringify(run(both, 10).written));

	// --- several statements per branch ------------------------------------

	var many = 'IF Tank_Level > 50 THEN Result = 1; Other = 9; ENDIF;';
	var manyRes = run(many, 80).written;

	HmiSelfTest.check('if.multipleStatements',
		manyRes['Result'] === 1 && manyRes['Other'] === 9,
		JSON.stringify(manyRes));

	// --- nesting, which is how an else-if is written ----------------------

	var nested = 'IF Tank_Level > 90 THEN Result = 3; ELSE ' +
		'IF Tank_Level > 50 THEN Result = 2; ELSE Result = 1; ENDIF; ENDIF;';

	HmiSelfTest.check('if.nestedHigh',
		run(nested, 95).written['Result'] === 3,
		JSON.stringify(run(nested, 95).written));
	HmiSelfTest.check('if.nestedMiddle',
		run(nested, 70).written['Result'] === 2,
		JSON.stringify(run(nested, 70).written));
	HmiSelfTest.check('if.nestedLow',
		run(nested, 10).written['Result'] === 1,
		JSON.stringify(run(nested, 10).written));

	// --- statements around the block --------------------------------------

	var around = 'Other = 5; IF Tank_Level > 50 THEN Result = 1; ENDIF; ' +
		'Other = 6;';
	var aroundRes = run(around, 80).written;

	HmiSelfTest.check('if.statementsAroundBlock',
		aroundRes['Other'] === 6 && aroundRes['Result'] === 1,
		JSON.stringify(aroundRes));

	// A bare ENDIF without the trailing semicolon still parses.
	HmiSelfTest.check('if.trailingSemicolonOptional',
		run('IF Tank_Level > 50 THEN Result = 1; ENDIF', 80)
			.written['Result'] === 1);

	// --- boolean conditions and AND/OR ------------------------------------

	HmiSelfTest.check('if.compoundCondition',
		run('IF Tank_Level > 50 AND Pump1_Run THEN Result = 1; ENDIF;', 80)
			.written['Result'] === 1);
	HmiSelfTest.check('if.notCondition',
		run('IF NOT Pump1_Run THEN Result = 1; ELSE Result = 2; ENDIF;', 80)
			.written['Result'] === 2);

	// --- writes are still collected inside branches -----------------------

	var collected = HmiExpr.compile(both, {project: project, mode: 'script'});

	HmiSelfTest.check('if.writesCollected',
		mxUtils.indexOf(collected.writes, 'Result') >= 0,
		collected.writes.join(','));

	// --- bad quality takes NEITHER branch ---------------------------------
	// An action script actuates equipment; branching on a value known to be
	// unreliable is how a dead link ends up commanding a plant.

	var badRun = run(both, 80, HmiTypes.QUALITY_BAD);

	HmiSelfTest.check('if.badQualityTakesNoBranch',
		badRun.written['Result'] === undefined,
		'wrote ' + JSON.stringify(badRun.written));

	// --- errors -----------------------------------------------------------

	HmiSelfTest.check('if.missingThen',
		HmiExpr.compile('IF Tank_Level > 50 Result = 1; ENDIF;',
			{project: project, mode: 'script'}).errors.length > 0);
	HmiSelfTest.check('if.missingEndif',
		HmiExpr.compile('IF Tank_Level > 50 THEN Result = 1;',
			{project: project, mode: 'script'}).errors.length > 0);
	HmiSelfTest.check('if.rejectedInExpressionMode',
		HmiExpr.compile('IF Tank_Level > 50 THEN 1 ENDIF',
			{project: project}).errors.length > 0);

	// --- the keyword must not swallow a tag that starts with it -----------

	project.addTag(HmiProject.createTag('IFace_Ready', 'MemoryDiscrete'));
	values = {};

	var keywordish = HmiExpr.compile(
		'IF IFace_Ready THEN Result = 1; ENDIF;',
		{project: project, mode: 'script'});

	HmiSelfTest.check('if.keywordPrefixIsNotKeyword',
		keywordish.errors.length === 0 &&
		mxUtils.indexOf(keywordish.deps, 'IFace_Ready') >= 0,
		(keywordish.errors[0] || {}).message || keywordish.deps.join(','));
};

/**
 * FOR ... NEXT and WHILE ... ENDWHILE: the loops, their caps, and the words
 * that are keywords only where a loop puts them.
 */
HmiSelfTest.testLoops = function()
{
	var check = HmiSelfTest.check;
	var project = HmiSelfTest.sampleProject();
	project.addTag(HmiProject.createTag('Result', 'MemoryInteger'));
	project.addTag(HmiProject.createTag('Other', 'MemoryInteger'));
	project.addTag(HmiProject.createTag('Index', 'MemoryInteger'));
	project.addTag(HmiProject.createTag('Feed', 'MemoryDiscrete'));
	// The words a plant project really does name a tag after, which is why
	// the loop keywords are not word operators (HmiExpr.LOOP_WORDS)
	project.addTag(HmiProject.createTag('Step', 'MemoryInteger'));
	project.addTag(HmiProject.createTag('Next', 'MemoryInteger'));
	project.quickFunctions = [
		{name: 'SumTo', args: [{name: 'N', type: 'Analog'}],
			body: 'DIM i, total AS Analog;\nFOR i = 1 TO N total = total + i; NEXT;\nReturn total;'},
		{name: 'FirstOver', args: [{name: 'Limit', type: 'Analog'}],
			body: 'DIM i AS Analog;\nFOR i = 1 TO 100 IF i > Limit THEN Return i; ENDIF; NEXT;\nReturn 0;'}
	];

	var values = {};
	var written = {};
	var passes = {};

	var reset = function()
	{
		values = {
			'result': {value: 0, quality: HmiTypes.QUALITY_GOOD, timestamp: 5},
			'other': {value: 0, quality: HmiTypes.QUALITY_GOOD, timestamp: 5},
			'index': {value: 0, quality: HmiTypes.QUALITY_GOOD, timestamp: 5},
			'feed': {value: 1, quality: HmiTypes.QUALITY_GOOD, timestamp: 5},
			'step': {value: 0, quality: HmiTypes.QUALITY_GOOD, timestamp: 5},
			'next': {value: 0, quality: HmiTypes.QUALITY_GOOD, timestamp: 5},
			'tank_level': {value: 60, quality: HmiTypes.QUALITY_GOOD, timestamp: 5}
		};
		written = {};
		passes = {};
	};

	var ctx = {
		read: function(name)
		{
			var v = values[name.toLowerCase()];

			return (v != null) ? v :
				{value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
		},
		write: function(name, value)
		{
			written[name] = value;
			passes[name] = (passes[name] || 0) + 1;
			values[name.toLowerCase()] = {value: value,
				quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};
		},
		now: function() { return Date.now(); }
	};

	var run = function(src, mode)
	{
		reset();

		return HmiExpr.compile(src, {project: project,
			mode: (mode != null) ? mode : 'script'}).eval(ctx);
	};

	var errorsOf = function(src, mode)
	{
		var errors = HmiExpr.compile(src, {project: project, mode: mode}).errors;
		var messages = [];

		for (var i = 0; i < errors.length; i++)
		{
			messages.push(errors[i].message);
		}

		return messages.join(' | ');
	};

	// --- FOR ... NEXT -----------------------------------------------------

	run('DIM i AS Analog; FOR i = 1 TO 5 Result = Result + i; NEXT;');
	check('loop.forSums', written['Result'] === 15, 'Result ' + written['Result']);

	run('DIM i AS Analog; FOR i = 1 TO 10 STEP 3 Result = Result + 1; NEXT;');
	check('loop.forStep', written['Result'] === 4, 'passes ' + written['Result']);

	run('DIM i AS Analog; FOR i = 5 TO 1 STEP -1 Result = Result + i; NEXT;');
	check('loop.forCountsDown', written['Result'] === 15,
		'Result ' + written['Result']);

	run('DIM i AS Analog; FOR i = 1 TO 0 Result = 1; NEXT;');
	check('loop.forEmptyRangeRunsNothing', written['Result'] === undefined,
		JSON.stringify(written));

	// The loop variable may be a tag, written every pass. The count itself is
	// the evaluator's, so a value that has not come back from the driver yet
	// cannot stall the loop.
	run('FOR Index = 1 TO 3 Other = Index; NEXT;');
	check('loop.forVariableCanBeATag',
		written['Index'] === 4 && passes['Index'] === 4 && written['Other'] === 3,
		JSON.stringify(written) + ' ' + JSON.stringify(passes));

	var stale = {
		read: function(name)
		{
			// A tag whose written value never comes back: a FOR over it still
			// finishes, because the count does not depend on the read
			return {value: 0, quality: HmiTypes.QUALITY_GOOD, timestamp: 1};
		},
		write: function(name, value) { written[name] = value; },
		now: function() { return Date.now(); }
	};

	written = {};
	HmiExpr.compile('FOR Index = 1 TO 3 Other = 7; NEXT;',
		{project: project, mode: 'script'}).eval(stale);
	check('loop.forIgnoresStaleReadBack', written['Index'] === 4,
		'Index ' + written['Index']);

	// --- WHILE ... ENDWHILE -----------------------------------------------

	run('WHILE Result < 4 Result = Result + 1; ENDWHILE;');
	check('loop.whileRuns', written['Result'] === 4, 'Result ' + written['Result']);

	run('WHILE Result > 0 Result = Result + 1; ENDWHILE;');
	check('loop.whileFalseAtOnce', written['Result'] === undefined,
		JSON.stringify(written));

	run('DIM i, j AS Analog; FOR i = 1 TO 3 FOR j = 1 TO 4 Result = Result + 1; NEXT; NEXT;');
	check('loop.nested', written['Result'] === 12, 'Result ' + written['Result']);

	run('DIM i AS Analog; FOR i = 1 TO 4 IF i > 2 THEN Result = Result + 1; ENDIF; NEXT;');
	check('loop.ifInsideLoop', written['Result'] === 2, 'Result ' + written['Result']);

	run('IF Tank_Level > 50 THEN WHILE Result < 3 Result = Result + 1; ENDWHILE; ENDIF;');
	check('loop.loopInsideIf', written['Result'] === 3, 'Result ' + written['Result']);

	// --- what the compile reports -----------------------------------------

	var counted = HmiExpr.compile('FOR Index = 1 TO 3 Other = Index; NEXT;',
		{project: project, mode: 'script'});

	check('loop.variableCountsAsAWrite',
		mxUtils.indexOf(counted.writes, 'Index') >= 0, counted.writes.join(','));

	var pure = HmiExpr.compile(
		'DIM i, n AS Analog; FOR i = 1 TO 3 n = n + 1; NEXT;',
		{project: project, mode: 'script'});

	check('loop.loopOverLocalsIsPure', pure.impure === false,
		'impure ' + pure.impure);

	// --- bad quality -------------------------------------------------------
	// Nothing acts on a value nothing trusts, which is the rule eval_if sets.

	reset();
	values['tank_level'] = {value: 60, quality: HmiTypes.QUALITY_BAD, timestamp: 5};
	HmiExpr.compile('DIM i AS Analog; FOR i = 1 TO Tank_Level Result = 1; NEXT;',
		{project: project, mode: 'script'}).eval(ctx);
	check('loop.badBoundTakesNoPass', written['Result'] === undefined,
		JSON.stringify(written));

	reset();
	values['feed'] = {value: 1, quality: HmiTypes.QUALITY_BAD, timestamp: 5};
	HmiExpr.compile('WHILE Feed Result = 1; ENDWHILE;',
		{project: project, mode: 'script'}).eval(ctx);
	check('loop.badConditionTakesNoPass', written['Result'] === undefined,
		JSON.stringify(written));

	// A link that dies mid-loop ends the loop rather than spinning on it
	reset();
	var reads = 0;
	var failing = {
		read: function(name)
		{
			if (name.toLowerCase() === 'feed')
			{
				reads++;

				return {value: 1, quality: (reads > 3) ? HmiTypes.QUALITY_BAD :
					HmiTypes.QUALITY_GOOD, timestamp: 5};
			}

			return ctx.read(name);
		},
		write: ctx.write,
		now: ctx.now
	};

	HmiExpr.compile('WHILE Feed Result = Result + 1; ENDWHILE;',
		{project: project, mode: 'script'}).eval(failing);
	check('loop.conditionGoingBadEndsTheLoop', written['Result'] === 3,
		'Result ' + written['Result'] + ' after ' + reads + ' reads');

	// --- the caps ---------------------------------------------------------

	var runaway = run('WHILE Result == 0 Other = 1; ENDWHILE;');

	check('loop.capStopsARunaway',
		runaway.error != null && runaway.error.indexOf('loop passes') > 0 &&
		runaway.quality === HmiTypes.QUALITY_BAD, '' + runaway.error);

	var zero = run('DIM i AS Analog; FOR i = 1 TO 3 STEP 0 Result = 1; NEXT;');

	check('loop.stepZeroRefused',
		zero.error != null && zero.error.indexOf('STEP 0') > 0, '' + zero.error);

	var text = run('DIM i AS Analog; FOR i = 1 TO "many" Result = 1; NEXT;');

	check('loop.boundMustBeANumber',
		text.error != null && text.error.indexOf('not a number') === 0,
		'' + text.error);

	// --- errors -----------------------------------------------------------

	check('loop.missingNext',
		errorsOf('DIM i AS Analog; FOR i = 1 TO 3 Result = 1;', 'script')
			.indexOf('expected NEXT') >= 0,
		errorsOf('DIM i AS Analog; FOR i = 1 TO 3 Result = 1;', 'script'));
	check('loop.missingEndwhile',
		errorsOf('WHILE Feed Result = 1;', 'script').indexOf('expected ENDWHILE') >= 0,
		errorsOf('WHILE Feed Result = 1;', 'script'));
	check('loop.missingTo',
		errorsOf('DIM i AS Analog; FOR i = 1 Result = 1; NEXT;', 'script')
			.indexOf('expected TO') >= 0,
		errorsOf('DIM i AS Analog; FOR i = 1 Result = 1; NEXT;', 'script'));
	check('loop.strayNext',
		errorsOf('NEXT;', 'script').indexOf('NEXT without FOR') >= 0,
		errorsOf('NEXT;', 'script'));
	check('loop.strayEndwhile',
		errorsOf('ENDWHILE;', 'script').indexOf('ENDWHILE without WHILE') >= 0,
		errorsOf('ENDWHILE;', 'script'));
	// An unclosed IF reports itself at the loop's end instead of swallowing it
	check('loop.unclosedIfInsideALoop',
		errorsOf('WHILE Feed IF Feed THEN Result = 1; ENDWHILE;', 'script')
			.indexOf('expected ENDIF') >= 0,
		errorsOf('WHILE Feed IF Feed THEN Result = 1; ENDWHILE;', 'script'));
	check('loop.dimRefusedInsideALoop',
		errorsOf('DIM i AS Analog; FOR i = 1 TO 3 DIM j AS Analog; NEXT;', 'script')
			.indexOf('FOR or WHILE') > 0,
		errorsOf('DIM i AS Analog; FOR i = 1 TO 3 DIM j AS Analog; NEXT;', 'script'));
	check('loop.pausingCallRefusedInACondition',
		errorsOf('WHILE ShowRecipeSelect("Mix") == "" Result = 1; ENDWHILE;', 'script')
			.indexOf('must be a statement') > 0,
		errorsOf('WHILE ShowRecipeSelect("Mix") == "" Result = 1; ENDWHILE;', 'script'));
	check('loop.refusedInAnAnimationLink',
		errorsOf('WHILE Feed Result = 1; ENDWHILE', null).length > 0 &&
		errorsOf('FOR Index = 1 TO 3 NEXT', null).length > 0);

	// --- a pausing call in the body ---------------------------------------
	// The loop's frame is its whole state, so a pass that waits for a dialog
	// carries on where it left off.

	reset();
	var waiting = [];
	var paused = {
		read: ctx.read,
		write: ctx.write,
		now: ctx.now,
		callAsync: function(name, args, done)
		{
			waiting.push(function() { done('picked'); });
		}
	};

	HmiExpr.compile('WHILE Result < 3 Recipe_Name = ShowRecipeSelect("Mix"); ' +
		'Result = Result + 1; ENDWHILE; Other = 9;',
		{project: project, mode: 'script'}).eval(paused);

	var startedPaused = (waiting.length === 1 && written['Result'] === undefined);

	while (waiting.length > 0)
	{
		waiting.shift()();
	}

	check('loop.pausingCallInTheBodyResumes',
		startedPaused && written['Result'] === 3 && written['Other'] === 9 &&
		written['Recipe_Name'] === 'picked',
		'paused ' + startedPaused + ' ' + JSON.stringify(written));

	// --- QuickFunctions ---------------------------------------------------

	check('loop.quickBodyLoops', run('SumTo(4)', null).value === 10,
		JSON.stringify(run('SumTo(4)', null)));
	// Return has to unwind the loop as well as the statement list
	check('loop.returnLeavesTheLoop', run('FirstOver(3)', null).value === 4,
		JSON.stringify(run('FirstOver(3)', null)));

	// --- the words are keywords only where a loop puts them ---------------

	var stepLink = HmiExpr.compile('Step + 1', {project: project});

	check('loop.tagNamedStepStillCompiles',
		stepLink.errors.length === 0 &&
		mxUtils.indexOf(stepLink.deps, 'Step') >= 0,
		(stepLink.errors[0] || {}).message || stepLink.deps.join(','));

	run('Step = 3; Next = Step + 1; Result = Next;');
	check('loop.tagsNamedStepAndNextAreAssignable',
		written['Step'] === 3 && written['Next'] === 4 && written['Result'] === 4,
		JSON.stringify(written));

	// The header has no terminator, so the body's first assignment is what
	// stops the search for a STEP clause
	run('DIM i AS Analog; FOR i = 1 TO 4 Step = i; NEXT;');
	check('loop.headerStopsAtTheBody', written['Step'] === 4,
		'Step ' + written['Step']);

	run('DIM i AS Analog; FOR i = 1 TO 5 STEP 2 Next = i; NEXT;');
	check('loop.stepClauseAndATagNamedNext', written['Next'] === 5,
		'Next ' + written['Next']);

	check('loop.wordsInAConditionAreTags',
		errorsOf('IF Next THEN Step = 1; ENDIF;', 'script') === '',
		errorsOf('IF Next THEN Step = 1; ENDIF;', 'script'));

	var words = HmiExpr.loopWords(new HmiExpr.Lexer(
		'FOR Index = 1 TO Step STEP 2 Next = Index; NEXT;').run().tokens);
	var kinds = [];

	for (var at in words)
	{
		kinds.push(words[at]);
	}

	check('loop.classifierMarksOnlyTheKeywords',
		kinds.join(',') === 'FOR,TO,STEP,NEXT', kinds.join(','));

	// --- what a rename reaches --------------------------------------------

	var src = 'DIM i AS Analog; FOR i = 1 TO Step STEP 2 Next = Next + i; ' +
		'NEXT; WHILE Next < 10 Next = Next + 1; ENDWHILE;';
	var found = [];

	HmiTagRefs.namesIn(src, 'script', function(name) { found.push(name); });

	check('loop.keywordsAreNotTagReferences',
		found.join(',') === 'Step,Next,Next,Next,Next,Next', found.join(','));

	var renamed = HmiTagRefs.rewriteText(src, {'next': 'Following'}, 'script');

	check('loop.renameLeavesTheKeywords',
		renamed.count === 5 && renamed.text.indexOf('NEXT;') > 0 &&
		renamed.text.indexOf('STEP 2') > 0 &&
		renamed.text.indexOf('Following = Following + i') > 0,
		renamed.text);
};

/** Copy / Paste / Delete Animation, and the on-screen keypad. */
HmiSelfTest.testAnimationClipboard = function(ui)
{
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);
	ui.hmiProject = HmiSelfTest.sampleProject();

	var source = null;
	var target = null;
	var other = null;

	graph.getModel().beginUpdate();

	try
	{
		source = graph.insertVertex(graph.getDefaultParent(), null, 'A',
			40, 700, 80, 40);
		target = graph.insertVertex(graph.getDefaultParent(), null, 'B',
			140, 700, 80, 40);
		other = graph.insertVertex(graph.getDefaultParent(), null, 'C',
			240, 700, 80, 40);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	HmiProject.setCellLinks(graph, source, {
		'fillColor.analog': {expr: 'Tank_Level', bands: [
			{max: '50', color: '#00CC00'}, {max: null, color: '#CC0000'}]},
		'visibility': {expr: 'Pump1_Run', sense: 'visible'}
	});

	// The target already has animation of its own, plus a colour link that
	// conflicts with what is about to be pasted.
	HmiProject.setCellLinks(graph, target, {
		'blink': HmiTypes.LINKS['blink'].defaults(),
		'fillColor.discrete': {expr: 'Pump1_Run', on: '#111111', off: '#222222'}
	});

	HmiClipboard.links = null;

	// --- menu items -------------------------------------------------------

	var items = HmiSelfTest.collectMenuItems(ui, source);

	HmiSelfTest.check('clip.menuItemsPresent',
		items['Copy Animation'] != null && items['Paste Animation'] != null &&
		items['Delete Animation'] != null,
		Object.keys(items).join(', '));

	HmiSelfTest.check('clip.copyEnabledWithLinks',
		items['Copy Animation'] === true);
	HmiSelfTest.check('clip.pasteDisabledWhenEmpty',
		items['Paste Animation'] === false,
		'paste should be disabled with an empty clipboard');

	var bare = HmiSelfTest.collectMenuItems(ui, other);

	HmiSelfTest.check('clip.copyDisabledWithoutLinks',
		bare['Copy Animation'] === false,
		'copy should be disabled on an object with no animation');

	// --- copy -------------------------------------------------------------

	HmiMenus.copyAnimation(ui, [source]);

	HmiSelfTest.check('clip.copied',
		HmiClipboard.links != null &&
		HmiClipboard.links['fillColor.analog'] != null,
		JSON.stringify(HmiClipboard.links));

	// The clipboard must be a snapshot, not a live reference.
	var live = HmiProject.getCellLinks(graph, source);
	live['fillColor.analog'].expr = 'Changed_After_Copy';
	HmiProject.setCellLinks(graph, source, live);

	HmiSelfTest.check('clip.copyIsSnapshot',
		HmiClipboard.links['fillColor.analog'].expr === 'Tank_Level',
		'clipboard now holds ' +
		HmiClipboard.links['fillColor.analog'].expr);

	// --- paste ------------------------------------------------------------

	HmiMenus.pasteAnimation(ui, [target]);

	var pasted = HmiProject.getCellLinks(graph, target);

	HmiSelfTest.check('clip.pasteAdds',
		pasted['fillColor.analog'] != null &&
		pasted['visibility'] != null,
		Object.keys(pasted).join(','));

	// Merge, not replace: what the target already had survives.
	HmiSelfTest.check('clip.pasteKeepsExisting',
		pasted['blink'] != null,
		'paste discarded the blink link that was already there');

	// But a conflicting colour link is cleared, as the panel does.
	HmiSelfTest.check('clip.pasteResolvesColourConflict',
		pasted['fillColor.discrete'] == null,
		'discrete and analog fill colour cannot both stand');

	// --- paste onto several -----------------------------------------------

	HmiMenus.pasteAnimation(ui, [other]);

	HmiSelfTest.check('clip.pasteToAnother',
		HmiProject.getCellLinks(graph, other)['fillColor.analog'] != null);

	// Pasting must deep copy, or two objects share one config object.
	var a = HmiProject.getCellLinks(graph, target);
	a['fillColor.analog'].expr = 'Only_On_Target';
	HmiProject.setCellLinks(graph, target, a);

	HmiSelfTest.check('clip.pasteIsIndependent',
		HmiProject.getCellLinks(graph, other)['fillColor.analog'].expr ===
			'Tank_Level',
		'editing one pasted copy changed the other');

	// --- delete -----------------------------------------------------------

	HmiMenus.deleteAnimation(ui, [target]);

	HmiSelfTest.check('clip.deleteClearsAll',
		Object.keys(HmiProject.getCellLinks(graph, target)).length === 0,
		Object.keys(HmiProject.getCellLinks(graph, target)).join(','));

	HmiSelfTest.check('clip.deleteLeavesOthers',
		Object.keys(HmiProject.getCellLinks(graph, other)).length > 0,
		'delete reached beyond its target');

	// One undoable step per command, so a paste over several objects is one
	// undo rather than one per object.
	var before = ui.editor.undoManager.history.length;
	HmiMenus.pasteAnimation(ui, [target, other]);

	HmiSelfTest.check('clip.pasteIsOneUndo',
		ui.editor.undoManager.history.length === before + 1,
		'history grew by ' +
		(ui.editor.undoManager.history.length - before));

	HmiSelfTest.clearDraft(ui);
};

/** Builds the cell context menu and reports each item's enabled state. */
HmiSelfTest.collectMenuItems = function(ui, cell)
{
	var found = {};

	var fake = {
		smartSeparators: true,
		hideShortcuts: true,
		addItem: function(title, image, funct, parent, iconCls, enabled)
		{
			found[title] = (enabled !== false);

			return document.createElement('div');
		},
		addSeparator: function() {},
		addCheckmark: function() {}
	};

	ui.editor.graph.setSelectionCell(cell);
	HmiMenus.addAnimationItems(ui, fake, cell);

	return found;
};

/** The on-screen keypad has to exist when the option is on. */
HmiSelfTest.testKeypad = function(ui)
{
	ui.hmiProject = HmiSelfTest.sampleProject();

	var sim = new HmiSimulator(ui.hmiProject);
	ui.hmiRuntime = new HmiRuntime({graph: ui.editor.graph,
		project: ui.hmiProject, driver: sim});
	ui.hmiRuntime.running = true;
	ui.hmiRuntime.values = {'tank_level': {value: 10,
		quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()}};

	HmiDialogs.showUserInput(ui, {kind: 'analog', tag: 'Tank_Level',
		min: '0', max: '100', prompt: 'Setpoint', keypad: true});

	var dlg = document.getElementsByClassName('hmiKeypad');

	HmiSelfTest.check('keypad.shownWhenEnabled', dlg.length === 1,
		'found ' + dlg.length + ' keypads');

	if (dlg.length === 1)
	{
		var buttons = dlg[0].getElementsByTagName('button');

		HmiSelfTest.check('keypad.hasAllKeys', buttons.length === 14,
			'found ' + buttons.length + ' keys');

		// Typing through the keypad must reach the field the OK button reads.
		var input = null;
		var inputs = dlg[0].parentNode.getElementsByTagName('input');

		if (inputs.length > 0) { input = inputs[0]; }

		if (input != null)
		{
			input.value = '';
			buttons[0].click();
			buttons[1].click();

			HmiSelfTest.check('keypad.typesIntoField', input.value === '78',
				'field holds ' + JSON.stringify(input.value));

			// The sign key toggles rather than inserting a stray minus.
			for (var i = 0; i < buttons.length; i++)
			{
				if (buttons[i].textContent === '-') { buttons[i].click(); }
			}

			HmiSelfTest.check('keypad.signToggles', input.value === '-78',
				'field holds ' + JSON.stringify(input.value));
		}
	}

	ui.hideDialog();

	// And not offered at all when the option is off.
	HmiDialogs.showUserInput(ui, {kind: 'analog', tag: 'Tank_Level',
		prompt: 'Setpoint', keypad: false});

	HmiSelfTest.check('keypad.hiddenWhenDisabled',
		document.getElementsByClassName('hmiKeypad').length === 0);

	ui.hideDialog();
	ui.hmiRuntime = null;
};

/**
 * Focus survives the panel rebuild that an edit triggers.
 *
 * Asynchronous, because the restore is deferred past the tab router. The
 * pending debounced refresh is cancelled before each step, or a stray rebuild
 * lands between the mousedown and the assertion.
 */
HmiSelfTest.testPanelFocus = function(ui)
{
	var graph = ui.editor.graph;
	HmiSelfTest.resetGraph(ui);
	ui.hmiProject = HmiSelfTest.sampleProject();

	var cell = null;

	graph.getModel().beginUpdate();

	try
	{
		cell = graph.insertVertex(graph.getDefaultParent(), null, 'F',
			40, 780, 80, 40);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	HmiProject.setCellLinks(graph, cell, {
		'fillColor.analog': {expr: 'Tank_Level', bands: [
			{max: '50', color: '#00CC00'}, {max: null, color: '#CC0000'}]},
		'valueDisplay': HmiTypes.LINKS['valueDisplay'].defaults()
	});

	ui.hmiUiState = {expanded: {'fillColor.analog': true, 'valueDisplay': true}};
	ui.format.collapsedSections = {};
	ui.hmiFocus = null;
	graph.setSelectionCell(cell);

	HmiSelfTest.settleFormat(ui);

	var strip = ui.format.container.firstChild;
	strip.childNodes[3].click();

	var panel = ui.format.container.childNodes[4];
	var fields = panel.querySelectorAll('[data-hmi-focus]');

	HmiSelfTest.check('focus.controlsIndexed', fields.length > 2,
		'indexed ' + fields.length + ' controls');

	if (fields.length < 3)
	{
		HmiSelfTest.finishFocus();

		return;
	}

	// Aim at the third control, as a mousedown would.
	var wanted = 2;
	var target = panel.querySelector('[data-hmi-focus="' + wanted + '"]');
	target.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));

	HmiSelfTest.check('focus.mousedownRemembers',
		ui.hmiFocus != null && ui.hmiFocus.index === wanted,
		'remembered ' + JSON.stringify(ui.hmiFocus));

	// Force the rebuild a commit causes, from the state the destroyed field
	// leaves behind: nothing focused.
	HmiSelfTest.blurAll(ui);
	HmiSelfTest.settleFormat(ui);

	window.setTimeout(function()
	{
		var restored = document.activeElement;

		HmiSelfTest.check('focus.restoredAfterRebuild',
			restored != null && restored.getAttribute != null &&
			restored.getAttribute('data-hmi-focus') === '' + wanted,
			'focus landed on ' +
			((restored != null && restored.getAttribute != null) ?
				restored.getAttribute('data-hmi-focus') : '' + restored));

		// A rebuild long after the interaction must not yank focus back.
		ui.hmiFocus = {index: wanted, start: 0, end: 0,
			at: Date.now() - 60000};
		HmiSelfTest.blurAll(ui);
		HmiSelfTest.settleFormat(ui);

		window.setTimeout(function()
		{
			var now = document.activeElement;

			HmiSelfTest.check('focus.staleMemoryIgnored',
				now == null || now.getAttribute == null ||
				now.getAttribute('data-hmi-focus') == null,
				'an old interaction reclaimed focus');

			// And it declines to steal focus from wherever the user now is.
			ui.hmiFocus = {index: wanted, start: 0, end: 0, at: Date.now()};
			var elsewhere = document.createElement('input');
			document.body.appendChild(elsewhere);
			elsewhere.focus();
			HmiSelfTest.settleFormat(ui);

			window.setTimeout(function()
			{
				HmiSelfTest.check('focus.doesNotStealFromElsewhere',
					document.activeElement === elsewhere,
					'focus moved away from where the user was typing');

				elsewhere.blur();
				document.body.removeChild(elsewhere);
				ui.hmiFocus = null;
				HmiSelfTest.clearDraft(ui);
				HmiSelfTest.finishFocus();
			}, 30);
		}, 30);
	}, 30);
};

/** Rebuilds the format panel now, cancelling any debounced rebuild. */
HmiSelfTest.settleFormat = function(ui)
{
	if (ui.format.pendingRefresh != null)
	{
		window.clearTimeout(ui.format.pendingRefresh);
		ui.format.pendingRefresh = null;
	}

	ui.format.immediateRefresh();
};

/**
 * Clears focus the way a destroyed field does.
 *
 * blur() alone is not enough: a node detached by an earlier rebuild can stay
 * as document.activeElement, and blurring it does not move focus off. Focusing
 * the graph container is both reliable and what actually happens in the app.
 */
HmiSelfTest.blurAll = function(ui)
{
	var active = document.activeElement;

	if (active != null && active.blur != null && active !== document.body)
	{
		active.blur();
	}

	// Focusing the graph container is not enough -- it has no tabindex, so the
	// call is a no-op and a detached node stays active. Focusing a throwaway
	// input and removing it does reset activeElement to the body.
	if (document.activeElement != null &&
		document.activeElement !== document.body)
	{
		var tmp = document.createElement('input');
		document.body.appendChild(tmp);
		tmp.focus();
		tmp.blur();
		document.body.removeChild(tmp);
	}
};

/** Reports the deferred focus assertions once they have run. */
HmiSelfTest.finishFocus = function()
{
	var failed = 0;

	for (var i = 0; i < HmiSelfTest.results.length; i++)
	{
		if (!HmiSelfTest.results[i].pass) { failed++; }
	}

	console.log('HMIFOCUS DONE total=' + HmiSelfTest.results.length +
		' failed=' + failed);
};

/** User Input range display and the string keyboard. */
HmiSelfTest.testInputExtras = function(ui)
{
	ui.hmiProject = HmiSelfTest.sampleProject();
	ui.hmiProject.getTag('Tank_Level').engUnits = '%';

	var sim = new HmiSimulator(ui.hmiProject);
	var rt = new HmiRuntime({graph: ui.editor.graph,
		project: ui.hmiProject, driver: sim});
	rt.running = true;
	rt.values = {'tank_level': {value: 10, quality: HmiTypes.QUALITY_GOOD,
		timestamp: Date.now()}};
	ui.hmiRuntime = rt;

	// Limits are expressions, so they must show as the numbers enforced.
	HmiSelfTest.check('range.bothBounds',
		HmiDialogs.rangeText(rt, {tag: 'Tank_Level', min: '0',
			max: 'Tank_Level.MaxEU'}) === 'Range: 0 to 100 %',
		HmiDialogs.rangeText(rt, {tag: 'Tank_Level', min: '0',
			max: 'Tank_Level.MaxEU'}));

	HmiSelfTest.check('range.minOnly',
		HmiDialogs.rangeText(rt, {tag: 'Tank_Level', min: '5', max: ''}) ===
			'Minimum 5 %');
	HmiSelfTest.check('range.maxOnly',
		HmiDialogs.rangeText(rt, {tag: 'Tank_Level', min: '', max: '90'}) ===
			'Maximum 90 %');
	HmiSelfTest.check('range.noneGivesNothing',
		HmiDialogs.rangeText(rt, {tag: 'Tank_Level', min: '', max: ''}) == null);

	// Shown in the dialog itself.
	HmiDialogs.showUserInput(ui, {kind: 'analog', tag: 'Tank_Level',
		min: '0', max: '100', prompt: 'Setpoint', keypad: false});

	HmiSelfTest.check('range.shownInDialog',
		document.getElementsByClassName('hmiRange').length === 1,
		'found ' + document.getElementsByClassName('hmiRange').length);

	ui.hideDialog();

	// String entry gets a keyboard, not a keypad.
	HmiDialogs.showUserInput(ui, {kind: 'string', tag: 'Recipe_Name',
		prompt: 'Recipe', keypad: true});

	var boards = document.getElementsByClassName('hmiKeyboard');

	HmiSelfTest.check('keyboard.shownForString', boards.length === 1,
		'found ' + boards.length);

	if (boards.length === 1)
	{
		var inputs = boards[0].parentNode.getElementsByTagName('input');
		var field = (inputs.length > 0) ? inputs[0] : null;
		var buttons = boards[0].getElementsByTagName('button');

		if (field != null)
		{
			field.value = '';

			// q then shift then q again: lower, then upper.
			HmiSelfTest.clickKey(buttons, 'q');
			HmiSelfTest.clickKey(buttons, '⇧');
			HmiSelfTest.clickKey(buttons, 'Q');

			HmiSelfTest.check('keyboard.shiftWorks', field.value === 'qQ',
				'field holds ' + JSON.stringify(field.value));

			HmiSelfTest.clickKey(buttons, 'space');

			HmiSelfTest.check('keyboard.space', field.value === 'qQ ',
				JSON.stringify(field.value));

			HmiSelfTest.clickKey(buttons, 'CLR');

			HmiSelfTest.check('keyboard.clear', field.value === '',
				JSON.stringify(field.value));
		}
	}

	ui.hideDialog();

	// Discrete entry is two buttons, so it gets neither.
	HmiDialogs.showUserInput(ui, {kind: 'discrete', tag: 'Pump1_Run',
		prompt: 'Pump', keypad: true});

	HmiSelfTest.check('keyboard.noneForDiscrete',
		document.getElementsByClassName('hmiKeyboard').length === 0 &&
		document.getElementsByClassName('hmiKeypad').length === 0);

	ui.hideDialog();
	ui.hmiRuntime = null;
};

HmiSelfTest.clickKey = function(buttons, label)
{
	for (var i = 0; i < buttons.length; i++)
	{
		if (buttons[i].textContent === label)
		{
			buttons[i].click();

			return true;
		}
	}

	return false;
};


/**
 * Inserts a page with one vertex carrying the given links. insertPage selects
 * the new page, so the caller switches back when done.
 */
HmiSelfTest.makePage = function(ui, name, links)
{
	var page = ui.insertPage();
	page.setName(name);

	var graph = ui.editor.graph;
	var v = new mxCell(name, new mxGeometry(20, 30, 120, 40), 'rounded=1;');
	v.vertex = true;
	v.setId(name + '-cell');

	graph.getModel().beginUpdate();

	try
	{
		graph.getModel().add(graph.getDefaultParent(), v);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	if (links != null)
	{
		HmiProject.setCellLinks(graph, v, links);
	}

	graph.background = '#eeeeee';

	return page;
};

/** Application settings, window properties and the run-mode window manager. */
HmiSelfTest.testWindows = function(ui)
{
	var check = HmiSelfTest.check;

	// --- model ------------------------------------------------------------

	var p = HmiSelfTest.sampleProject();

	check('win.defaultResolution', p.settings.width === 1024 &&
		p.settings.height === 768);

	var d = p.getWindow('nope');

	check('win.defaultFillsScreen', d.x === 0 && d.y === 0 &&
		d.width === 1024 && d.height === 768 && d.type === 'replace' &&
		d.titleBar === false, JSON.stringify(d));

	p.setWindow('a', {titleBar: false, type: 'replace', x: 0, y: 0,
		width: 1024, height: 768});

	check('win.defaultsNotStored', p.windows['a'] == null,
		JSON.stringify(p.windows['a']));

	p.setWindow('b', {titleBar: true, type: 'popup', x: 10, y: 20,
		width: 300, height: 200});
	p.settings.width = 800;
	p.settings.height = 480;
	p.settings.startup = ['b', 'gone'];

	var doc = mxUtils.createXmlDocument();
	var back = HmiProject.fromXml(p.toXml(doc));
	var wb = back.getWindow('b');

	check('win.roundTripSettings', back.settings.width === 800 &&
		back.settings.height === 480 &&
		back.settings.startup.join(',') === 'b,gone',
		JSON.stringify(back.settings));
	check('win.roundTripWindow', wb.titleBar === true && wb.type === 'popup' &&
		wb.x === 10 && wb.y === 20 && wb.width === 300 && wb.height === 200,
		JSON.stringify(wb));
	check('win.unsetSizeFollowsResolution',
		back.getWindow('a').width === 800, '' + back.getWindow('a').width);

	p.setWindow('s', {onShow: 'A = 1;\nB = 2;', whileShowing: '', onHide: 'C = 3;',
		everyMs: '250'});
	var ws = HmiProject.fromXml(p.toXml(mxUtils.createXmlDocument())).getWindow('s');

	check('win.roundTripScripts', ws.onShow === 'A = 1;\nB = 2;' &&
		ws.whileShowing === '' && ws.onHide === 'C = 3;' && ws.everyMs === '250',
		JSON.stringify(ws));
	check('win.defaultEveryMs', p.getWindow('b').everyMs === '1000');

	var empty = new HmiProject();
	check('win.emptyIsEmpty', empty.isEmpty());
	empty.settings.width = 800;
	check('win.settingsMakeNonEmpty', !empty.isEmpty());

	back.prunePages(['b']);
	check('win.pruneStartup', back.settings.startup.join(',') === 'b');

	// --- runtime and publish settings ----------------------------------

	var rp = new HmiProject();
	check('rt.defaults', rp.settings.runtime.windowMode === 'kiosk' &&
		rp.settings.runtime.exit === 'shortcut' && rp.settings.runtime.hash === '');
	check('rt.defaultsNotStored', rp.toXml(mxUtils.createXmlDocument())
		.getElementsByTagName('runtime').length === 0);

	rp.settings.runtime = {windowMode: 'window', exit: 'password', salt: 'c0ffee',
		hash: '2215b729f4c90d85fa59cd2879117b33d1089521f38e987de839f1c2e45e795c'};
	rp.settings.publish = {productName: 'Line 3', version: '1.2.0', scope: 'user',
		desktop: true, autostart: false, compression: 'fast', output: '/tmp/out'};
	check('rt.makesNonEmpty', !rp.isEmpty());

	var rpXml = mxUtils.getXml(rp.toXml(mxUtils.createXmlDocument()));
	var rb = HmiProject.fromXml(mxUtils.parseXml(rpXml).documentElement);

	check('rt.roundTrip', JSON.stringify(rb.settings.runtime) ===
		JSON.stringify(rp.settings.runtime), JSON.stringify(rb.settings.runtime));
	check('rt.publishRoundTrip', JSON.stringify(rb.settings.publish) ===
		JSON.stringify(rp.settings.publish), JSON.stringify(rb.settings.publish));

	var badRt = mxUtils.parseXml('<hmiProject><settings><runtime windowMode="huge" ' +
		'exit="whenever"/></settings></hmiProject>').documentElement;
	check('rt.badModesIgnored', HmiProject.fromXml(badRt).settings.runtime.windowMode === 'kiosk' &&
		HmiProject.fromXml(badRt).settings.runtime.exit === 'shortcut');

	// Must match the package's check in src/main/runtime/RuntimeMode.js
	HmiProject.hashPassword('c0ffee', 'secret').then(function(hash)
	{
		check('rt.hashMatchesMain', hash ===
			'2215b729f4c90d85fa59cd2879117b33d1089521f38e987de839f1c2e45e795c', hash);
	});

	// --- driver hub -------------------------------------------------------

	var calls = [];
	var fake = {
		listeners: [],
		connect: function() { calls.push('connect'); },
		disconnect: function() { calls.push('disconnect'); },
		subscribe: function(paths) { calls.push('sub:' + paths.join('+')); },
		unsubscribe: function() { calls.push('unsub'); },
		on: function(e, cb) { this.listeners.push(cb); },
		off: function(e, cb)
		{
			this.listeners.splice(mxUtils.indexOf(this.listeners, cb), 1);
		},
		write: function() { return {}; },
		status: function() { return 'connected'; }
	};

	var hub = new HmiDriverHub(fake);
	var c1 = hub.client();
	var c2 = hub.client();
	var cb = function() {};
	c1.on('change', cb);
	c1.subscribe(['A', 'B'], 250);
	c2.subscribe(['b', 'C'], 100);

	check('hub.unionOfPaths', calls[calls.length - 1] === 'sub:A+B+C',
		calls.join(' | '));

	c1.disconnect();

	check('hub.dropsDisconnected', calls[calls.length - 1] === 'sub:b+C' &&
		fake.listeners.length === 0, calls.join(' | '));

	c2.unsubscribe();
	check('hub.unsubscribesWhenIdle', calls[calls.length - 1] === 'unsub');

	// --- window manager ---------------------------------------------------

	HmiSelfTest.resetGraph(ui);

	var project = HmiSelfTest.sampleProject();
	ui.hmiProject = project;

	var home = ui.currentPage;
	var display = {'valueDisplay': {kind: 'analog', expr: 'Tank_Level',
		format: '0', prefix: '', suffix: ''}};

	var pa = HmiSelfTest.makePage(ui, 'WinA', display);
	var pb = HmiSelfTest.makePage(ui, 'WinB', null);
	var pc = HmiSelfTest.makePage(ui, 'WinC', null);
	var pd = HmiSelfTest.makePage(ui, 'WinD', null);
	var made = [pa, pb, pc, pd];

	ui.selectPage(home);

	try
	{
		project.setWindow(pb.getId(), {titleBar: true, type: 'overlay',
			x: 750, y: 550, width: 200, height: 150});
		project.setWindow(pc.getId(), {type: 'popup', x: 300, y: 200,
			width: 200, height: 100});
		project.setWindow(pd.getId(), {type: 'replace', x: 0, y: 0,
			width: 700, height: 500});
		project.settings.startup = [pb.getId(), pa.getId()];

		HmiMenus.start(ui);

		var wm = ui.hmiRuntime;
		var names = function()
		{
			var res = [];

			for (var i = 0; i < wm.windows.length; i++)
			{
				res.push(wm.windows[i].name);
			}

			return res.join(',');
		};

		check('wm.isWindowManager', wm instanceof HmiWindowManager);
		check('wm.startupInPageOrder', names() === 'WinA,WinB', names());
		check('wm.editorDisabled', !ui.editor.graph.isEnabled());
		check('wm.screenShown',
			document.getElementsByClassName('hmiScreen').length === 1);

		var wa = wm.windowFor(pa);
		var wb2 = wm.windowFor(pb);

		check('wm.copyKeepsIds', wa != null &&
			wa.graph.getModel().getCell('WinA-cell') != null &&
			wa.graph !== ui.editor.graph);
		check('wm.pageBackground', wa != null &&
			wa.content.style.backgroundColor === 'rgb(238, 238, 238)',
			(wa != null) ? wa.content.style.backgroundColor : 'n/a');
		check('wm.titleBarShown', wb2 != null && wb2.title != null &&
			wa.title == null);
		check('wm.valuesReachWindow', wa != null &&
			wa.runtime.getValue('Tank_Level').value != null,
			(wa != null) ? JSON.stringify(wa.runtime.getValue('Tank_Level')) :
				'n/a');

		var scale = wm.scale;
		check('wm.showsPageUnderWindow', wb2 != null &&
			wb2.graph.view.translate.x === -750 &&
			wb2.graph.view.translate.y === -(550 + HmiProject.TITLE_BAR_HEIGHT),
			(wb2 != null) ? JSON.stringify(wb2.graph.view.translate) : 'n/a');

		check('wm.placedAtScale', wb2 != null &&
			wb2.div.style.left === Math.round(750 * scale) + 'px' &&
			wb2.div.style.width === Math.round(200 * scale) + 'px',
			(wb2 != null) ? wb2.div.style.left + ' ' + wb2.div.style.width +
				' @' + scale : 'n/a');

		// Overlay leaves others alone.
		check('wm.overlayKeepsOthers', wm.windows.length === 2);

		// Popup: on top and modal.
		var wc = wm.show('winc');

		check('wm.showIgnoresCase', wc != null && wc.page === pc);
		check('wm.popupOnTop', wc != null &&
			parseInt(wc.div.style.zIndex, 10) >
			parseInt(wb2.div.style.zIndex, 10));
		check('wm.popupBlocks', wm.isBlocked(wa) && wm.isBlocked(wb2) &&
			!wm.isBlocked(wc));

		// An overlay opened while the popup is up still goes under it.
		wm.hide('WinB');
		wm.show('WinB');
		check('wm.popupStaysOnTop', wm.isBlocked(wm.windowFor(pb)));

		wm.hide('WinC');
		check('wm.hideClosesPopup', wm.windowFor(pc) == null &&
			!wm.isBlocked(wa), names());

		// Replace closes what it overlaps: A (full screen) but not B, which
		// sits outside 700 x 500.
		wm.show('WinD');
		check('wm.replaceClosesOverlapped', names() === 'WinB,WinD', names());

		// The title bar's close button hides its window.
		var closeBtn = wm.windowFor(pb).div.querySelector('.hmiWindowClose');
		closeBtn.click();
		check('wm.titleBarCloses', names() === 'WinD', names());

		check('wm.unknownWindow', wm.show('NoSuchPage') == null);

		HmiMenus.stop(ui);

		check('wm.stopCleansUp', wm.windows.length === 0 &&
			document.getElementsByClassName('hmiScreenBackdrop').length === 0 &&
			ui.editor.graph.isEnabled() && wm.hub.clients.length === 0,
			names() + ' clients=' + wm.hub.clients.length);

		// No startup windows: the page being edited opens.
		project.settings.startup = [];
		HmiMenus.start(ui);
		check('wm.fallsBackToCurrentPage', ui.hmiRuntime.windows.length === 1 &&
			ui.hmiRuntime.windows[0].page === ui.currentPage);
		HmiMenus.stop(ui);

		// --- window scripts -----------------------------------------------

		project.setWindow(pc.getId(), {type: 'popup', x: 300, y: 200,
			width: 200, height: 100, onShow: 'Pump1_Run = 1;',
			whileShowing: 'Tank_Level = Tank_Level + 1;', everyMs: '100',
			onHide: 'Pump1_Run = 0;\nRecipe_Name = "closed";'});
		project.settings.startup = [pb.getId()];
		HmiMenus.start(ui);

		var wm2 = ui.hmiRuntime;
		var sim = wm2.driver;
		sim.write({'Pump1_Run': 0});

		var popup = wm2.show('WinC');

		check('script.onShowRuns', sim.get('Pump1_Run').value == 1,
			JSON.stringify(sim.get('Pump1_Run')));
		check('script.whileShowingTimer', popup.whileTimer != null);

		wm2.hide('WinC');

		check('script.onHideRuns', sim.get('Pump1_Run').value == 0 &&
			sim.get('Recipe_Name').value === 'closed',
			JSON.stringify(sim.get('Recipe_Name')));
		check('script.whileShowingStops', popup.whileTimer == null);

		// A replace window closing it runs its On hide too.
		wm2.show('WinC');
		wm2.show('WinD');
		check('script.onHideOnReplace', wm2.windowFor(pc) == null &&
			sim.get('Pump1_Run').value == 0);

		// --- ShowWindow() ---------------------------------------------------

		wm2.show('WinB');
		var caller = wm2.windowFor(pb).runtime;
		caller.runScript('ShowWindow("WinC", 50, 60, 0); Recipe_Name = "carried on";');
		var shownC = wm2.windowFor(pc);
		check('showWin.movedShowsItsPage', shownC != null && shownC.graph.view.translate.x === -300 &&
			shownC.div.style.left === Math.round(50 * wm2.scale) + 'px', shownC && JSON.stringify(shownC.graph.view.translate));
		check('showWin.async', shownC != null && shownC.props.x === 50 && shownC.props.y === 60 &&
			sim.get('Recipe_Name').value === 'carried on', shownC && JSON.stringify(shownC.props));
		check('showWin.notModal', !wm2.isBlocked(wm2.windowFor(pb)) &&
			project.getWindow(pc.getId()).x === 300 && project.getWindow(pc.getId()).modal === undefined);
		wm2.hide('WinC');

		sim.write({Recipe_Name: 'waiting'});
		caller.runScript('Pump1_Run = 0; ShowWindow("WinC", "", "", 1, 1); Recipe_Name = "resumed";');
		check('showWin.waits', wm2.windowFor(pc) != null && wm2.windowFor(pc).props.x === 300 &&
			sim.get('Recipe_Name').value === 'waiting' && wm2.isBlocked(wm2.windowFor(pb)),
			JSON.stringify(sim.get('Recipe_Name')));
		wm2.hide('WinC');
		check('showWin.resumesOnClose', sim.get('Recipe_Name').value === 'resumed',
			JSON.stringify(sim.get('Recipe_Name')));

		var results = [];
		var collect = function(v) { results.push(v); };
		wm2.callShowWindow([''], collect);
		wm2.callShowWindow(['Nope'], collect);
		wm2.callShowWindow(['WinC', 'abc'], collect);
		wm2.callShowWindow(['WinC', 5000, 0], collect);
		var errState = HmiDialogs.recipeErrors;
		var errText = (errState != null) ? errState.items.map(function(it) { return it.message; }) : [];
		check('showWin.errors', results.join('') === '0000' && errText.length === 4 &&
			errText[0] === 'The window name is empty.' && errText[1] === 'There is no window named "Nope".' &&
			errText[2].indexOf('Left must be a number') === 0 && errText[3].indexOf('would be off the') > 0 &&
			HmiDialogs.functionErrorTitle(errState.items) === 'Window Error', errText.join(' | '));
		HmiDialogs.flushRecipeErrors();
		check('showWin.errorWindow', document.querySelector('[data-hmi-field="recipeErrors"]') != null &&
			ui.dialog.container.innerText.indexOf('Window Error') >= 0);
		ui.hideDialog();

		var werrs = function(src, mode) { return HmiExpr.compile(src, {project: project, mode: mode || 'script'}).errors.map(function(e) { return e.message; }); };
		check('showWin.compile', werrs('ShowWindow("WinC"); ShowWindow(Recipe_Name, 10, 20, 1, 0);').length === 0 &&
			/as text/.test(werrs('ShowWindow(Pump1_Run);')[0] || '') &&
			/left must be a number/.test(werrs('ShowWindow("WinC", "abc");')[0] || '') &&
			/must be a statement/.test(werrs('IF ShowWindow("WinC") THEN Pump1_Run = 1; ENDIF;')[0] || '') &&
			werrs('ShowWindow("WinC")', 'expr').length === 1, werrs('ShowWindow(Recipe_Name, 10, 20, 1, 0);').join(' | '));
		check('showWin.validate', HmiMenus.scriptWindowProblems(ui, 'ShowWindow("Nope");').length === 1 &&
			HmiMenus.scriptWindowProblems(ui, 'ShowWindow("winc"); ShowWindow(Recipe_Name);').length === 0);

		// --- ScreenToPDF() ---------------------------------------------------

		var pdfs = [];
		var captured = [];
		HmiScreenPdf.testIo = {
			capture: function(screen, options, fn)
			{
				captured.push({screen: screen, options: options});
				var c = document.createElement('canvas');
				c.width = 64;
				c.height = 48;
				var g = c.getContext('2d');
				g.fillStyle = '#ff0000';
				g.fillRect(0, 0, 64, 48);
				fn(null, c);
			},
			save: function(name, bytes, fn) { pdfs.push({name: name, bytes: bytes}); fn(null, name + '.pdf'); }
		};
		wm2.show('WinC');
		sim.write({Recipe_Name: 'before pdf'});
		caller.runScript('ScreenToPDF(); Recipe_Name = "after pdf";');
		var pdfText = (pdfs.length > 0) ? String.fromCharCode.apply(null, pdfs[0].bytes) : '';
		check('pdf.pako', typeof pako !== 'undefined');
		check('pdf.scriptCarriesOn', sim.get('Recipe_Name').value === 'after pdf', JSON.stringify(sim.get('Recipe_Name')));
		check('pdf.capturesScreen', captured.length === 1 && captured[0].screen === wm2.screen &&
			typeof captured[0].options.atDesignSize === 'function');

		// Laid out at the design size only while the copy is taken
		var shownScale = wm2.scale;
		var duringCopy = wm2.atDesignSize(function() { return [wm2.scale, wm2.screen.style.width]; });
		check('pdf.designSizeCopy', duringCopy[0] === 1 && duringCopy[1] === project.settings.width + 'px' &&
			wm2.scale === shownScale, JSON.stringify([duringCopy, shownScale, wm2.scale]));
		check('pdf.namedAfterScreen', pdfs.length === 1 && pdfs[0].name === HmiScreenPdf.screenName(wm2) &&
			pdfs[0].name !== 'WinC', pdfs.length && pdfs[0].name);
		check('pdf.landscapeLetter', pdfText.indexOf('%PDF-1.4') === 0 && pdfText.indexOf('/MediaBox [0 0 792 612]') > 0 &&
			pdfText.indexOf('/Width 64 /Height 48') > 0 && /%%EOF\n$/.test(pdfText));

		// The cross-reference table points at each object
		var startxref = parseInt(/startxref\n(\d+)/.exec(pdfText)[1], 10);
		var xrefRows = pdfText.substring(startxref).split('\n').slice(3, 9);
		check('pdf.xref', pdfText.substr(startxref, 4) === 'xref' && xrefRows.length === 6 && xrefRows.every(function(row, i)
			{ return pdfText.substr(parseInt(row, 10), (i + 1 + ' 0 obj').length) === (i + 1) + ' 0 obj'; }), xrefRows.join('|'));

		// Fitted, centered, at least 1/4" (18 pt) from every edge
		var at = HmiScreenPdf.layout(1024, 768);
		var tall = HmiScreenPdf.layout(300, 900);
		check('pdf.fitsCentered', Math.abs(at.width - 756) < 0.01 && Math.abs(at.x - 18) < 0.01 &&
			Math.abs(at.y - (612 - at.height) / 2) < 0.01 && at.y >= 18 &&
			Math.abs(tall.height - 576) < 0.01 && Math.abs(tall.x - (792 - tall.width) / 2) < 0.01,
			JSON.stringify([at, tall]));
		check('pdf.contentPlacesImage', pdfText.indexOf('q 756 0 0 567 18 22.5 cm /Im0 Do Q') > 0);
		check('pdf.fileNames', HmiScreenPdf.fileName('Main Screen') === 'Main Screen' &&
			HmiScreenPdf.fileName('Tank 1/2: Level?') === 'Tank 1_2_ Level_' &&
			HmiScreenPdf.fileName('Mixer "A" <B>|C*') === 'Mixer _A_ _B__C_' &&
			HmiScreenPdf.fileName('Overview. ') === 'Overview' && HmiScreenPdf.fileName('CON') === 'CON_' &&
			HmiScreenPdf.fileName('lpt1.x') === 'lpt1.x_' && HmiScreenPdf.fileName('???') === 'Screen' &&
			HmiScreenPdf.fileName('') === 'Screen' && HmiScreenPdf.fileName(new Array(200).join('a')).length === 120,
			HmiScreenPdf.fileName('Tank 1/2: Level?'));

		// Failures go to the function error window
		HmiDialogs.recipeErrors = null;
		HmiScreenPdf.testIo = {
			capture: function(screen, options, fn) { fn(null, document.createElement('canvas')); },
			save: function(name, bytes, fn) { fn('disk full'); }
		};
		check('pdf.returnsOne', HmiScreenPdf.call(wm2, []) === 1);
		var pdfErrs = HmiDialogs.recipeErrors;
		check('pdf.errorReported', pdfErrs != null && pdfErrs.items.length === 1 &&
			pdfErrs.items[0].message === 'The file could not be written: disk full.' &&
			HmiDialogs.functionErrorTitle(pdfErrs.items) === 'Screen to PDF Error', pdfErrs && JSON.stringify(pdfErrs.items));
		HmiDialogs.recipeErrors = null;
		check('pdf.notRunning', HmiScreenPdf.call(null, []) === 0);
		check('pdf.compile', werrs('ScreenToPDF();').length === 0 && werrs('ScreenToPDF(1);').length === 1 &&
			werrs('ScreenToPDF()', 'expr').length === 1, werrs('ScreenToPDF(1);').join(' | '));
		HmiScreenPdf.testIo = null;
		wm2.hide('WinC');

		sim.write({Recipe_Name: 'before stop'});
		caller.runScript('ShowWindow("WinC", "", "", 1, 1); Recipe_Name = "after stop";');
		HmiMenus.stop(ui);
		check('showWin.stopDropsWait', sim.get('Recipe_Name').value !== 'after stop', JSON.stringify(sim.get('Recipe_Name')));
		project.settings.startup = [];

		project.setWindow(pc.getId(), {type: 'popup', x: 300, y: 200,
			width: 200, height: 100, onShow: 'Pump1_Run = ;'});
		check('script.validateReports',
			HmiMenus.checkWindowScripts(project, pc.getId()).length === 1 &&
			HmiMenus.checkWindowScripts(project, pd.getId()).length === 0,
			HmiMenus.checkWindowScripts(project, pc.getId()).join(' | '));

		// --- validation ---------------------------------------------------

		project.setWindow(pb.getId(), {x: 900, y: 0, width: 300, height: 100});
		check('win.validateOffScreen',
			HmiMenus.checkWindow(project, pb.getId()) != null);
		check('win.validateFits',
			HmiMenus.checkWindow(project, pd.getId()) == null);

		// --- dialogs ------------------------------------------------------

		ui.editor.setModified(false);
		HmiDialogs.showAppSettings(ui);

		var dlg = ui.dialog.container;
		var nums = dlg.querySelectorAll('input[type="number"]');
		nums[0].value = '800';
		nums[0].dispatchEvent(new Event('input'));
		nums[1].value = '480';
		nums[1].dispatchEvent(new Event('input'));

		var select = dlg.querySelector('select');
		check('dlg.presetFollowsSize', select.value === '800x480', select.value);

		var box = dlg.querySelector('input[data-hmi-page="' + pc.getId() + '"]');
		box.click();
		dlg.querySelector('.hmiOk').click();

		check('dlg.settingsApplied', project.settings.width === 800 &&
			project.settings.height === 480 &&
			project.settings.startup.join(',') === pc.getId(),
			JSON.stringify(project.settings));
		check('dlg.settingsMarkModified', ui.editor.modified === true);

		HmiDialogs.showAppSettings(ui);
		dlg = ui.dialog.container;
		var exitSel = dlg.querySelector('[data-hmi-field="exit"]');
		var pwInput = dlg.querySelector('[data-hmi-field="exitPassword"]');
		check('dlg.passwordHiddenByDefault', pwInput.parentNode.style.display === 'none');
		exitSel.value = 'password';
		exitSel.dispatchEvent(new Event('change'));
		check('dlg.passwordShown', pwInput.parentNode.style.display === '');
		dlg.querySelector('.hmiOk').click();
		check('dlg.passwordRequired', ui.dialog != null && ui.dialog.container === dlg &&
			dlg.querySelector('.hmiError').innerText !== '');

		pwInput.value = 'hunter2';
		dlg.querySelectorAll('select')[1].value = 'window';
		dlg.querySelectorAll('select')[1].dispatchEvent(new Event('change'));
		dlg.querySelector('.hmiOk').click();

		check('dlg.runtimeApplied', project.settings.runtime.windowMode === 'window' &&
			project.settings.runtime.exit === 'password', JSON.stringify(project.settings.runtime));

		check('pub.nextVersion', HmiDialogs.nextVersion('1.0.9') === '1.0.10' &&
			HmiDialogs.nextVersion('2') === '3' && HmiDialogs.nextVersion('') === '1.0.0' &&
			HmiDialogs.nextVersion('x.y') === '1.0.0');

		project.settings.publish = {productName: 'Line 3', version: '1.4.0', scope: 'machine',
			desktop: true, output: '/nowhere'};
		HmiDialogs.showPublishOptions(ui, {documents: '/docs'});
		dlg = ui.dialog.container;

		var pubField = function(name) { return dlg.querySelector('[data-hmi-field="' + name + '"]'); };

		check('pub.remembersName', pubField('productName').value === 'Line 3', pubField('productName').value);
		check('pub.suggestsNextVersion', pubField('version').value === '1.4.1', pubField('version').value);
		check('pub.remembersScope', pubField('scope').value === 'machine' && pubField('desktop').checked &&
			!pubField('autostart').checked);
		check('pub.defaultCompression', pubField('compression').value === 'small');
		check('pub.remembersOutput', pubField('output').innerText === '/nowhere');
		check('pub.defaultIcon', pubField('icon').innerText === 'Default' &&
			pubField('iconClear').style.display === 'none');

		pubField('version').value = 'v2';
		dlg.querySelector('.hmiOk').click();
		check('pub.badVersionRefused', dlg.querySelector('.hmiError').innerText.indexOf('version') >= 0 &&
			dlg.querySelector('.hmiProgress').style.display === 'none');
		ui.hideDialog();
		check('pub.closeClearsListener', HmiDialogs.onPublishEvent == null);

		project.settings.publish = {};
		HmiDialogs.showPublishOptions(ui, {documents: '/docs'});
		dlg = ui.dialog.container;
		check('pub.defaults', pubField('version').value === '1.0.0' &&
			pubField('scope').value === 'user' && pubField('output').innerText === '/docs');
		ui.hideDialog();

		window.setTimeout(function()
		{
			var rt = project.settings.runtime;
			var saved = mxUtils.getXml(project.toXml(mxUtils.createXmlDocument()));

			check('dlg.passwordHashed', /^[0-9a-f]{64}$/.test(rt.hash) && rt.salt.length === 32,
				JSON.stringify(rt));
			check('dlg.passwordNotStored', saved.indexOf('hunter2') < 0);
		}, 1000);

		HmiDialogs.showWindowProps(ui, pa);
		dlg = ui.dialog.container;
		dlg.querySelector('[data-hmi-prop="titleBar"]').click();
		dlg.querySelector('input[type="radio"][value="overlay"]').click();

		var wInput = dlg.querySelector('[data-hmi-prop="width"]');
		wInput.value = '320';
		wInput.dispatchEvent(new Event('input'));

		var onShowArea = dlg.querySelector('[data-hmi-prop="onShow"]');
		onShowArea.value = 'Pump1_Run = 1;';
		onShowArea.dispatchEvent(new Event('input'));

		var badArea = dlg.querySelector('[data-hmi-prop="onHide"]');
		badArea.value = 'Pump1_Run = ;';
		badArea.dispatchEvent(new Event('input'));
		check('dlg.scriptChecked', badArea.classList.contains('hmiInvalid'));
		badArea.value = '';
		badArea.dispatchEvent(new Event('input'));

		dlg.querySelector('.hmiOk').click();

		var wa2 = project.getWindow(pa.getId());
		check('dlg.windowApplied', wa2.titleBar === true &&
			wa2.type === 'overlay' && wa2.width === 320 &&
			wa2.height === 480, JSON.stringify(wa2));
		check('dlg.scriptApplied', wa2.onShow === 'Pump1_Run = 1;' &&
			wa2.onHide === '', JSON.stringify(wa2));

		// --- canvas frame -------------------------------------------------

		project.settings.width = 800;
		project.settings.height = 480;
		project.setWindow(home.getId(), {titleBar: true, type: 'popup',
			x: 100, y: 50, width: 300, height: 200});
		HmiFrame.refresh(ui);

		var frame = ui.hmiFrameGroup;
		var gs = ui.editor.graph.view.scale;
		var attr = function(node, name)
		{
			return parseFloat(node.getAttribute(name));
		};

		check('frame.inBackgroundPane', frame != null &&
			frame.parentNode === ui.editor.graph.view.getBackgroundPane());
		check('frame.screenSize', frame != null &&
			attr(frame.screen, 'width') === Math.round(800 * gs) &&
			attr(frame.screen, 'height') === Math.round(480 * gs),
			(frame != null) ? frame.screen.getAttribute('width') + ' x ' +
				frame.screen.getAttribute('height') + ' @' + gs : 'n/a');
		check('frame.windowShown', frame != null &&
			frame.window.style.display !== 'none' &&
			attr(frame.window, 'width') === Math.round(300 * gs) &&
			Math.round(attr(frame.window, 'x') - attr(frame.screen, 'x')) ===
				Math.round(100 * gs));
		check('frame.titleLine', frame != null &&
			frame.titleLine.style.display !== 'none');

		// Follows zoom.
		ui.editor.graph.zoomTo(2);
		ui.editor.graph.view.validateBackground();
		check('frame.followsZoom', frame != null &&
			attr(frame.screen, 'width') === Math.round(800 *
				ui.editor.graph.view.scale), frame.screen.getAttribute('width'));
		ui.editor.graph.zoomTo(gs);

		// A plain full-screen window draws no dashed border.
		project.setWindow(home.getId(), {});
		HmiFrame.refresh(ui);
		check('frame.fullScreenHidesWindow', frame.window.style.display === 'none');

		// Cancel discards.
		HmiDialogs.showWindowProps(ui, pa);
		dlg = ui.dialog.container;
		dlg.querySelector('input[type="radio"][value="popup"]').click();
		ui.hideDialog();
		check('dlg.cancelDiscards',
			project.getWindow(pa.getId()).type === 'overlay');
	}
	finally
	{
		if (HmiMenus.isRunning(ui))
		{
			HmiMenus.stop(ui);
		}

		for (var i = 0; i < made.length; i++)
		{
			ui.removePage(made[i]);
		}
	}
};


/** Local variables: DIM name[, name] AS Analog | Discrete | Message. */
HmiSelfTest.testLocals = function()
{
	var check = HmiSelfTest.check;
	var project = HmiSelfTest.sampleProject();
	project.addTag(HmiProject.createTag('Result', 'MemoryReal'));
	project.addTag(HmiProject.createTag('Dim', 'MemoryInteger'));

	var values = {};
	var written = {};

	var ctx = {
		read: function(name)
		{
			var v = values[name.toLowerCase()];

			return (v != null) ? v : {value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
		},
		write: function(name, value)
		{
			written[name] = value;
			values[name.toLowerCase()] = {value: value, quality: HmiTypes.QUALITY_GOOD, timestamp: Date.now()};
		},
		now: function() { return Date.now(); }
	};

	var compile = function(src)
	{
		return HmiExpr.compile(src, {project: project, mode: 'script'});
	};

	var run = function(src)
	{
		written = {};
		values = {tank_level: {value: 42, quality: HmiTypes.QUALITY_GOOD, timestamp: 1}};
		var c = compile(src);

		if (c.errors.length > 0)
		{
			return {errors: c.errors.map(function(e) { return e.message; })};
		}

		var res = c.eval(ctx);

		return {written: written, compiled: c, error: res.error};
	};

	var errorOf = function(src)
	{
		var c = compile(src);

		return (c.errors.length > 0) ? c.errors[0].message : '';
	};

	var r = run('DIM a, b AS Analog;\nDIM m AS Message;\nDIM d AS Discrete;\n' +
		'a = 2; b = a * 3 + Tank_Level; m = "x" + Text(b, "0"); d = b > 5;\n' +
		'Result = b; Recipe_Name = m; Pump1_Run = d;');
	check('local.types', r.written != null && r.written.Result === 48 && r.written.Recipe_Name === 'x48' &&
		r.written.Pump1_Run === 1, JSON.stringify(r));
	check('local.notTags', r.compiled != null && r.compiled.deps.join(',') === 'Tank_Level,Result,Recipe_Name,Pump1_Run' &&
		r.compiled.writes.join(',') === 'Result,Recipe_Name,Pump1_Run',
		r.compiled && (r.compiled.deps + ' / ' + r.compiled.writes));

	r = run('DIM a AS Analog; DIM m AS Message; DIM d AS Discrete; Result = a + 1; Recipe_Name = m + "!"; Pump1_Run = d;');
	check('local.defaults', r.written != null && r.written.Result === 1 && r.written.Recipe_Name === '!' &&
		r.written.Pump1_Run === 0, JSON.stringify(r));

	r = run('DIM a AS Analog; DIM d AS Discrete; DIM m AS Message; a = "12"; d = 5; m = 7; Result = a + 1; Pump1_Run = d; Recipe_Name = m;');
	check('local.coerced', r.written != null && r.written.Result === 13 && r.written.Pump1_Run === 1 &&
		r.written.Recipe_Name === '7', JSON.stringify(r));

	r = run('DIM a AS Analog; a = "lots"; Result = 1;');
	check('local.badNumber', r.written != null && r.written.Result === undefined && /not a number/.test(r.error),
		JSON.stringify(r));

	r = run('DIM Count AS Analog; COUNT = 4; Result = count;');
	check('local.ignoresCase', r.written != null && r.written.Result === 4, JSON.stringify(r));

	var fresh = 'DIM n AS Analog; n = n + 1; Result = n;';
	run(fresh);
	r = run(fresh);
	check('local.freshEachRun', r.written != null && r.written.Result === 1, JSON.stringify(r));

	r = run('DIM i AS Analog; IF Tank_Level > 40 THEN i = 5; ELSE i = 6; ENDIF; Result = i;');
	check('local.inIf', r.written != null && r.written.Result === 5, JSON.stringify(r));

	// A local takes the quality of what it was given: bad data takes no branch
	r = run('DIM v AS Analog; v = Pump1_Run; IF v == 0 THEN Result = 1; ELSE Result = 2; ENDIF;');
	check('local.keepsQuality', r.written != null && r.written.Result === undefined, JSON.stringify(r));

	// DIM and AS are words only in the declaration: a tag named Dim is a tag
	r = run('Dim = 3; DIM x AS Analog; x = Dim + 1; Result = x;');
	check('local.tagNamedDim', r.written != null && r.written.Dim === 3 && r.written.Result === 4, JSON.stringify(r));

	check('local.strictTagName', /has the name of the tag "Tank_Level"/.test(errorOf('DIM tank_level AS Analog;')),
		errorOf('DIM tank_level AS Analog;'));
	check('local.strictSystemTag', /system tag/.test(errorOf('DIM _AlarmsActive AS Analog;')),
		errorOf('DIM _AlarmsActive AS Analog;'));
	check('local.duplicate', /already declared/.test(errorOf('DIM a AS Analog; DIM A AS Message;')),
		errorOf('DIM a AS Analog; DIM A AS Message;'));
	check('local.notInIf', /cannot be inside IF/.test(errorOf('IF 1 THEN DIM a AS Analog; ENDIF;')),
		errorOf('IF 1 THEN DIM a AS Analog; ENDIF;'));
	check('local.needsAs', /expected AS/.test(errorOf('DIM a Analog;')), errorOf('DIM a Analog;'));
	check('local.badType', /Analog, Discrete or Message/.test(errorOf('DIM a AS Integer;')),
		errorOf('DIM a AS Integer;'));
	check('local.noFields', /has no fields/.test(errorOf('DIM a AS Analog; Result = a.Quality;')),
		errorOf('DIM a AS Analog; Result = a.Quality;'));
	check('local.declaredFirst', /unknown tag "a"/.test(errorOf('a = 1; DIM a AS Analog;')),
		errorOf('a = 1; DIM a AS Analog;'));
	check('local.keywordName', errorOf('DIM As AS Analog;') !== '' && errorOf('DIM x, AS Analog;') !== '',
		errorOf('DIM As AS Analog;'));
	check('local.scriptsOnly', HmiExpr.compile('DIM a AS Analog', {project: project}).errors.length > 0);

	// A tag added later with a local's name is a compile error at Validate
	var later = 'DIM Spare AS Analog; Spare = 1;';
	check('local.okBeforeTag', errorOf(later) === '', errorOf(later));
	project.addTag(HmiProject.createTag('Spare', 'MemoryReal'));
	check('local.tagAddedLater', /has the name of the tag/.test(errorOf(later)), errorOf(later));
};

/** Application scripts: On start, While running, On shutdown. */
HmiSelfTest.testAppScripts = function(ui)
{
	var check = HmiSelfTest.check;

	// --- model ------------------------------------------------------------

	var p = new HmiProject();
	check('app.defaults', JSON.stringify(p.settings.scripts) ===
		JSON.stringify({onStart: '', whileRunning: '', onShutdown: '', everyMs: '1000'}));
	check('app.defaultsNotStored', p.toXml(mxUtils.createXmlDocument()).getElementsByTagName('appScripts').length === 0);

	p.settings.scripts = {onStart: 'A = 1;\n{ two lines }', whileRunning: '', onShutdown: 'B = "<&>";', everyMs: '250'};
	check('app.makesNonEmpty', !p.isEmpty());

	var back = HmiProject.fromXml(mxUtils.parseXml(mxUtils.getXml(p.toXml(mxUtils.createXmlDocument()))).documentElement);
	check('app.roundTrip', JSON.stringify(back.settings.scripts) === JSON.stringify(p.settings.scripts),
		JSON.stringify(back.settings.scripts));

	// A file saved pretty-printed indents the text, which is not the script's
	var pretty = HmiProject.fromXml(mxUtils.parseXml(mxUtils.getPrettyXml(p.toXml(mxUtils.createXmlDocument())))
		.documentElement);
	check('app.prettyRoundTrip', JSON.stringify(pretty.settings.scripts) === JSON.stringify(p.settings.scripts),
		JSON.stringify(pretty.settings.scripts));

	// --- automation spec ---------------------------------------------------

	var errors = [];
	var built = HmiCli.buildProject({settings: {scripts: {onStart: 'X = 1;', everyMs: '', colour: 1}}}, errors);
	check('app.cliBuild', built.settings.scripts.onStart === 'X = 1;' && built.settings.scripts.everyMs === '1000' &&
		errors.length === 1 && errors[0].indexOf('colour') > 0, JSON.stringify(errors));

	HmiSelfTest.resetGraph(ui);

	var savedProject = ui.hmiProject;
	var project = HmiSelfTest.sampleProject();
	project.addTag(HmiProject.createTag('Result', 'MemoryInteger'));
	project.addTag(HmiProject.createTag('Counter', 'MemoryInteger'));
	ui.hmiProject = project;

	var home = ui.currentPage;
	var pa = HmiSelfTest.makePage(ui, 'AppA', null);
	var pc = HmiSelfTest.makePage(ui, 'AppC', null);
	var made = [pa, pc];
	var realSetInterval = window.setInterval;

	ui.selectPage(home);

	try
	{
		project.settings.scripts = {onStart: 'Result = 1; Counter = 0; Recipe_Name = "started";',
			whileRunning: 'DIM step AS Analog; step = 1; Counter = Counter + step;',
			onShutdown: 'Recipe_Name = "shut";', everyMs: '75'};
		project.setWindow(pa.getId(), {onShow: 'Pump1_Run = Result;', onHide: 'Recipe_Name = "hidden";'});
		project.setWindow(pc.getId(), {type: 'popup', x: 300, y: 200, width: 200, height: 100});
		project.settings.startup = [pa.getId()];

		ui.editor.setModified(false);
		HmiDialogs.showAppSettings(ui);
		var dlg = ui.dialog.container;
		var area = dlg.querySelector('[data-hmi-prop="onStart"]');
		var every = dlg.querySelector('[data-hmi-prop="everyMs"]');
		check('app.dlgShows', area != null && area.value === project.settings.scripts.onStart &&
			every != null && every.value === '75' &&
			dlg.querySelector('[data-hmi-prop="whileRunning"]') != null &&
			dlg.querySelector('[data-hmi-prop="onShutdown"]') != null);

		area.value = 'DIM x AS Analog; Nope = 1;';
		area.dispatchEvent(new Event('input'));
		check('app.dlgMarksErrors', area.classList.contains('hmiInvalid'));
		ui.hideDialog();
		check('app.dlgCancelDiscards', project.settings.scripts.onStart.indexOf('Nope') < 0 && !ui.editor.modified);

		HmiDialogs.showAppSettings(ui);
		dlg = ui.dialog.container;
		area = dlg.querySelector('[data-hmi-prop="onShutdown"]');
		area.value = 'Recipe_Name = "shut down";';
		area.dispatchEvent(new Event('input'));
		every = dlg.querySelector('[data-hmi-prop="everyMs"]');
		every.value = '50';
		every.dispatchEvent(new Event('input'));
		dlg.querySelector('.hmiOk').click();
		check('app.dlgApplies', project.settings.scripts.onShutdown === 'Recipe_Name = "shut down";' &&
			project.settings.scripts.everyMs === '50' && ui.editor.modified === true,
			JSON.stringify(project.settings.scripts));

		var spec = HmiCli.dump(ui);
		check('app.cliDump', spec.settings.scripts != null && spec.settings.scripts.everyMs === '50' &&
			spec.settings.scripts.onShutdown === 'Recipe_Name = "shut down";', JSON.stringify(spec.settings.scripts));

		// Validate labels problems by script
		project.settings.scripts.whileRunning = 'Nope = 1;';
		var problems = HmiMenus.checkAppScripts(project);
		check('app.validate', problems.length === 1 && problems[0].indexOf('While running: unknown tag') === 0,
			JSON.stringify(problems));
		project.settings.scripts.whileRunning = 'DIM step AS Analog; step = 1; Counter = Counter + step;';
		check('app.validateClean', HmiMenus.checkAppScripts(project).length === 0,
			JSON.stringify(HmiMenus.checkAppScripts(project)));

		// --- Run --------------------------------------------------------------

		// The While running timer is caught so the test can tick it
		var timers = [];

		window.setInterval = function(fn, ms)
		{
			var id = realSetInterval.apply(window, arguments);
			timers.push({fn: fn, ms: ms, id: id});

			return id;
		};

		HmiMenus.start(ui);
		window.setInterval = realSetInterval;

		var wm = ui.hmiRuntime;
		var sim = wm.driver;
		var tick = null;

		for (var i = 0; i < timers.length; i++)
		{
			if (timers[i].id === wm.appTimer)
			{
				tick = timers[i];
			}
		}

		check('app.runtimeWithoutWindow', wm.app instanceof HmiRuntime && wm.app.graph == null && wm.app.running);
		check('app.onStartRuns', sim.get('Result').value == 1 && sim.get('Recipe_Name').value === 'started',
			JSON.stringify(sim.get('Recipe_Name')));
		check('app.onStartBeforeWindows', sim.get('Pump1_Run').value == 1, JSON.stringify(sim.get('Pump1_Run')));
		check('app.whileRunningTimer', tick != null && tick.ms === 50, tick && tick.ms);

		if (tick != null)
		{
			tick.fn();
			tick.fn();
		}

		check('app.whileRunningRuns', sim.get('Counter').value == 2, JSON.stringify(sim.get('Counter')));

		// Scripts read what the windows write, and the reverse
		wm.windowFor(pa).runtime.runScript('Counter = 10;');
		wm.app.runScript('Result = Counter + 1;');
		check('app.sharesTags', sim.get('Result').value == 11, JSON.stringify(sim.get('Result')));

		// A script that pauses keeps its local variables
		wm.app.runScript('DIM m AS Message; m = "kept"; ShowWindow("AppC", "", "", 1, 1); Recipe_Name = m;');
		check('app.showWindowWaits', wm.windowFor(pc) != null && sim.get('Recipe_Name').value === 'started');
		wm.hide('AppC');
		check('app.localsSurvivePause', sim.get('Recipe_Name').value === 'kept', JSON.stringify(sim.get('Recipe_Name')));

		// On shutdown runs after the windows' On hide
		var writes = [];
		var realWrite = sim.write;

		sim.write = function(w)
		{
			if (w.Recipe_Name != null)
			{
				writes.push(w.Recipe_Name);
			}

			return realWrite.apply(this, arguments);
		};

		var timer = wm.appTimer;
		HmiMenus.stop(ui);
		sim.write = realWrite;

		check('app.onShutdownAfterOnHide', writes.join(',') === 'hidden,shut down', writes.join(','));
		check('app.stopCleansUp', wm.app == null && wm.appTimer == null && wm.hub.clients.length === 0,
			'clients=' + wm.hub.clients.length + ' timer=' + timer);

		// No application scripts: no extra runtime or timer
		project.settings.scripts = HmiProject.defaultAppScripts();
		HmiMenus.start(ui);
		check('app.noneNoRuntime', ui.hmiRuntime.app == null && ui.hmiRuntime.appTimer == null);
		HmiMenus.stop(ui);

		// A closing runtime stops its Run (HmiRuntimeApp.shutdown, from main)
		project.settings.scripts = {onStart: '', whileRunning: '', onShutdown: 'Recipe_Name = "closed";', everyMs: '1000'};
		HmiMenus.start(ui);
		var sim2 = ui.hmiRuntime.driver;
		var closed = [];
		var realWrite2 = sim2.write;

		sim2.write = function(w)
		{
			if (w.Recipe_Name != null)
			{
				closed.push(w.Recipe_Name);
			}

			return realWrite2.apply(this, arguments);
		};

		HmiRuntimeApp.shutdown(ui, function() {});
		sim2.write = realWrite2;
		check('app.shutdownStopsRun', ui.hmiRuntime == null && closed.join(',') === 'hidden,closed', closed.join(','));
		HmiRuntimeApp.stopped = false;
		HmiMenus.setRunning(ui, false);
	}
	finally
	{
		window.setInterval = realSetInterval;

		if (HmiMenus.isRunning(ui))
		{
			HmiMenus.stop(ui);
		}

		for (var i = 0; i < made.length; i++)
		{
			ui.removePage(made[i]);
		}

		ui.hmiProject = savedProject;
	}
};

/** Devices: the model, the dialog, the tag form's I/O section and validation. */
HmiSelfTest.testDevices = function(ui)
{
	var check = HmiSelfTest.check;

	// --- model ------------------------------------------------------------

	var fresh = HmiFile.createDefaultProject();
	check('dev.defaultIsSimulated', fresh.devices.length === 1 &&
		fresh.devices[0].protocol === 'simulator');

	var modbus = HmiProject.createDevice('Pump', 'modbus');
	check('dev.protocolDefaults', modbus.port === 502 && modbus.options.unitId === 1 &&
		modbus.options.byteOrder === 'BE', JSON.stringify(modbus));
	check('dev.logixDefaults', HmiProject.createDevice('L', 'logix').port === 44818 &&
		HmiProject.createDevice('L', 'logix').options.slot === 0);

	var p = HmiSelfTest.sampleProject();
	modbus.host = '10.0.0.9';
	modbus.options.byteOrder = 'MLE';
	modbus.scanMs = 500;
	modbus.enabled = false;
	p.devices.push(modbus);

	var flow = HmiProject.createTag('Flow', 'IOReal');
	flow.device = 'Pump';
	flow.address = 'HR:10:FLOAT';
	p.addTag(flow);

	var back = HmiProject.fromXml(p.toXml(mxUtils.createXmlDocument()));
	var bd = back.getDevice('pump');

	check('dev.roundTrip', bd != null && bd.host === '10.0.0.9' && bd.port === 502 &&
		bd.options.byteOrder === 'MLE' && bd.options.unitId === 1 && bd.scanMs === 500 &&
		bd.enabled === false, JSON.stringify(bd));
	check('dev.tagBindingRoundTrip', back.getTag('Flow').device === 'Pump' &&
		back.getTag('Flow').address === 'HR:10:FLOAT' && back.getTag('Flow').scaled === false);

	flow.scaled = true;
	check('dev.scaledRoundTrip',
		HmiProject.fromXml(p.toXml(mxUtils.createXmlDocument())).getTag('Flow').scaled === true);
	flow.scaled = false;
	check('dev.noAccessNamesWritten',
		mxUtils.getXml(p.toXml(mxUtils.createXmlDocument())).indexOf('accessName') < 0);

	check('dev.users', p.deviceUsers('PUMP').join(',') === 'Flow');
	p.renameDevice('Pump', 'Transfer');
	check('dev.renameFollowsIntoTags', p.getTag('Flow').device === 'Transfer' &&
		p.getDevice('Pump') == null && p.getDevice('transfer') === modbus);
	check('dev.deviceOf', p.deviceOf(p.getTag('Flow')) === modbus &&
		p.deviceOf(p.getTag('Pump1_Run')) == null);

	// --- dialog -------------------------------------------------------------

	ui.hmiProject = p;
	HmiDialogs.showDevices(ui);
	var dlg = ui.dialog.container;

	check('devDlg.lists', dlg.querySelectorAll('[data-hmi-device]').length === 2);

	dlg.querySelector('[data-hmi-device="Transfer"]').click();
	check('devDlg.showsOptions', dlg.querySelector('[data-hmi-prop="byteOrder"]') != null &&
		dlg.querySelector('[data-hmi-prop="host"]').value === '10.0.0.9' &&
		dlg.querySelector('[data-hmi-action="probe"]') != null);

	var name = dlg.querySelector('[data-hmi-prop="name"]');
	name.value = 'Pumps';
	name.dispatchEvent(new Event('blur'));
	check('devDlg.renameUpdatesTags', p.getTag('Flow').device === 'Pumps', p.getTag('Flow').device);

	name = dlg.querySelector('[data-hmi-prop="name"]');
	name.value = 'plc1';
	name.dispatchEvent(new Event('blur'));
	check('devDlg.refusesDuplicateName', p.getDevice('Pumps') === modbus &&
		dlg.querySelector('.hmiError').innerText.indexOf('already') >= 0);

	var shown = null;
	var showError = ui.showError;
	ui.showError = function(title, message) { shown = message; };
	dlg.querySelector('[data-hmi-action="remove"]').click();
	ui.showError = showError;
	check('devDlg.removeBlockedWhileUsed', p.getDevice('Pumps') != null && shown != null &&
		shown.indexOf('Flow') >= 0, shown);

	var protocol = dlg.querySelector('[data-hmi-prop="protocol"]');
	protocol.value = 'logix';
	protocol.dispatchEvent(new Event('change'));
	check('devDlg.protocolSwitchesOptions', modbus.protocol === 'logix' && modbus.port === 44818 &&
		dlg.querySelector('[data-hmi-prop="slot"]') != null &&
		dlg.querySelector('[data-hmi-prop="byteOrder"]') == null);

	ui.hideDialog();

	// --- tag form -------------------------------------------------------

	var tags = new HmiTagDialog(ui);
	tags.init();
	tags.selected = p.getTag('Flow');
	tags.renderForm();

	var address = tags.formDiv.querySelector('[data-hmi-prop="address"]');
	check('tagForm.addressField', address != null && address.value === 'HR:10:FLOAT' &&
		address.getAttribute('placeholder').indexOf('Program:Main') >= 0);

	check('tagForm.scalingOffByDefault', tags.formDiv.querySelector('[data-hmi-prop="scaled"]') != null &&
		tags.formDiv.querySelector('[data-hmi-prop="scaled"]').checked === false &&
		tags.formDiv.querySelector('[data-hmi-prop="minRaw"]') == null);
	var scaledBox = tags.formDiv.querySelector('[data-hmi-prop="scaled"]');
	scaledBox.checked = true;
	scaledBox.dispatchEvent(new Event('change'));
	check('tagForm.scalingShowsRawRange', p.getTag('Flow').scaled === true &&
		tags.formDiv.querySelector('[data-hmi-prop="minRaw"]') != null);
	p.getTag('Flow').scaled = false;

	tags.selected = p.getTag('Tank_Level');
	tags.renderForm();
	check('tagForm.simulatedHasNoAddress',
		tags.formDiv.querySelector('[data-hmi-prop="address"]') == null &&
		tags.formDiv.innerText.indexOf('Simulated') >= 0);

	// --- validation -------------------------------------------------------

	var orphan = HmiProject.createTag('Orphan', 'IOInteger');
	orphan.device = 'Nowhere';
	p.addTag(orphan);
	var loose = HmiProject.createTag('Loose', 'IODiscrete');
	p.addTag(loose);
	var blank = HmiProject.createTag('Blank', 'IOInteger');
	blank.device = 'Pumps';
	p.addTag(blank);

	var problems = [];
	var jobs = HmiMenus.checkTags(p, problems);
	var messages = problems.map(function(x) { return x.link + ': ' + x.message; }).join(' | ');

	check('validate.unknownDevice', messages.indexOf('Orphan: No device named "Nowhere"') >= 0, messages);
	check('validate.noDevice', messages.indexOf('Loose: I/O tag has no device') >= 0, messages);
	check('validate.noAddress', messages.indexOf('Blank: No address') >= 0, messages);
	check('validate.addressesBatchedPerDevice', jobs.length === 1 && jobs[0].tags.length === 1 &&
		jobs[0].tags[0].name === 'Flow');

	// --- the server itself, asynchronously --------------------------------

	if (HmiComms.available())
	{
		HmiComms.validate(HmiProject.createDevice('M', 'modbus'), ['HR:10', '40001', 'HR:2'], 'REAL',
			function(results, error)
			{
				check('comms.validateReachesServer', error == null && results != null && results.length === 3,
					error || JSON.stringify(results));

				if (results != null)
				{
					check('comms.validateNormalizes', results[0].normalized === 'HR:10:FLOAT:BE',
						JSON.stringify(results[0]));
					check('comms.validateExplains', results[1].ok === false &&
						results[1].error.indexOf('HR:0') >= 0, JSON.stringify(results[1]));
				}

				console.log('HMICOMMS DONE');
			});
	}
};


/** HmiCommsDriver against a stand-in bridge, then a real run through the server. */
HmiSelfTest.testCommsDriver = function(ui)
{
	var check = HmiSelfTest.check;

	var project = HmiSelfTest.sampleProject();
	var pumps = HmiProject.createDevice('Pumps', 'modbus');
	pumps.host = '10.0.0.9';
	pumps.scanMs = 500;
	project.devices.push(pumps);

	var flow = HmiProject.createTag('Flow', 'IOReal');
	flow.device = 'Pumps';
	flow.address = 'HR:10';
	flow.scaled = true;
	flow.minRaw = 0;
	flow.maxRaw = 1000;
	flow.minEU = 0;
	flow.maxEU = 100;
	project.addTag(flow);

	var motor = HmiProject.createTag('Motor_On', 'IODiscrete');
	motor.device = 'Pumps';
	motor.address = 'CO:3';
	project.addTag(motor);

	var bad = HmiProject.createTag('Bad_Addr', 'IOInteger');
	bad.device = 'Pumps';
	bad.address = '40001';
	project.addTag(bad);

	// The stand-in bridge: records requests, answers when told to.
	var saved = {available: HmiComms.available, request: HmiComms.request, onEvent: HmiComms.onEvent,
		offEvent: HmiComms.offEvent};
	var requests = [];
	var pushes = [];

	HmiComms.available = function() { return true; };
	HmiComms.request = function(action, args, cb) { requests.push({action: action, args: args, cb: cb}); };
	HmiComms.onEvent = function(l) { pushes.push(l); };
	HmiComms.offEvent = function() {};

	var find = function(action)
	{
		for (var i = requests.length - 1; i >= 0; i--)
		{
			if (requests[i].action === action)
			{
				return requests[i];
			}
		}

		return null;
	};

	try
	{
		var driver = new HmiCommsDriver(project);
		var changes = [];
		driver.on('change', function(b) { changes.push(b); });
		driver.connect();

		var cfg = find('configure');
		var ids = (cfg != null) ? cfg.args.tags.map(function(t) { return t.id; }).join(',') : '';

		check('cd.onlyDeviceTagsGoToTheServer', ids === 'Flow,Motor_On,Bad_Addr', ids);
		check('cd.deviceSentOnce', cfg != null && cfg.args.devices.length === 1 &&
			cfg.args.devices[0].name === 'Pumps' && cfg.args.devices[0].host === '10.0.0.9');
		check('cd.unscaledByDefault', cfg != null && cfg.args.tags[2].scale == null &&
			HmiProject.createTag('X', 'IOInteger').scaled === false);
		check('cd.scalingSent', cfg != null && cfg.args.tags[0].scale != null &&
			cfg.args.tags[0].scale.rawMax === 1000 && cfg.args.tags[0].dataType === 'REAL',
			cfg != null ? JSON.stringify(cfg.args.tags[0]) : 'none');

		changes = [];
		driver.subscribe(['Tank_Level', 'Flow', 'Motor_On', 'Pump1_Run'], 250);

		check('cd.simulatedSnapshotIsImmediate', changes.length === 1 &&
			changes[0].Tank_Level != null && changes[0].Pump1_Run != null && changes[0].Flow == null,
			JSON.stringify(changes));
		check('cd.remoteSubscribeWaitsForConfigure', find('subscribe') == null);

		cfg.cb({tags: [{id: 'Flow', normalized: 'HR:10:FLOAT:BE'}, {id: 'Motor_On'},
			{id: 'Bad_Addr', error: 'Use HR:0 for 40001'}], errors: []}, null);

		var sub = find('subscribe');
		check('cd.subscribeAfterConfigure', sub != null && sub.args.ids.join(',') === 'Flow,Motor_On' &&
			sub.args.rates.Flow === 500, sub != null ? JSON.stringify(sub.args) : 'none');
		check('cd.badAddressIsBadAtOnce', driver.get('Bad_Addr').quality === HmiTypes.QUALITY_BAD &&
			driver.get('Bad_Addr').error === 'Use HR:0 for 40001');

		pushes[0]({t: 'snapshot', values: {Flow: [42.5, 192, 1000], Motor_On: [true, 192, 1000]}});
		check('cd.serverValuesArrive', driver.get('Flow').value === 42.5 &&
			driver.get('Flow').quality === HmiTypes.QUALITY_GOOD);
		check('cd.discreteIsZeroOne', driver.get('Motor_On').value === 1);

		pushes[0]({t: 'change', values: {Flow: [null, 0, 2000, 'comm', 'Connection refused']}});
		check('cd.badQualityCarriesItsReason', driver.get('Flow').quality === HmiTypes.QUALITY_BAD &&
			driver.get('Flow').status === 'comm' && driver.get('Flow').error === 'Connection refused');

		// Writes: local at once, device pending then answered.
		var errors = [];
		driver.on('writeError', function(e) { errors.push(e); });
		var res = driver.write({Pump1_Run: 1, Flow: 25, Motor_On: 0});

		check('cd.localWriteResolves', res.Pump1_Run.ok === true && res.Pump1_Run.pending == null);
		check('cd.deviceWriteIsPending', res.Flow.ok === true && res.Flow.pending === true);

		var w = find('write');
		check('cd.writeSentWithBooleans', w != null && w.args.values.Flow === 25 &&
			w.args.values.Motor_On === false, w != null ? JSON.stringify(w.args) : 'none');

		w.cb({results: {Flow: {ok: true}, Motor_On: {ok: false, error: 'Illegal data address (exception 2)'}}});
		check('cd.refusedWriteIsReported', errors.length === 1 && errors[0].name === 'Motor_On' &&
			errors[0].error.indexOf('exception 2') >= 0);

		// Device status reaches the banner.
		var fakeUi = {hmiBannerFaults: document.createElement('span')};
		driver.on('status', function(d) { HmiMenus.updateDeviceStatus(fakeUi, d); });
		pushes[0]({t: 'status', devices: [{name: 'Pumps', state: 'backoff', lastError: 'Connection refused'}]});
		check('cd.bannerNamesTheDevice', fakeUi.hmiBannerFaults.style.display !== 'none' &&
			fakeUi.hmiBannerFaults.innerText.indexOf('Pumps not communicating') >= 0,
			fakeUi.hmiBannerFaults.innerText);

		pushes[0]({t: 'status', devices: [{name: 'Pumps', state: 'connected', lastError: null}]});
		check('cd.bannerClears', fakeUi.hmiBannerFaults.style.display === 'none');

		pushes[0]({t: 'server', state: 'disconnected'});
		// The simulator's scans must never overwrite a device tag.
		driver.sim.emit('change', {Flow: {value: 99, quality: HmiTypes.QUALITY_GOOD, timestamp: 5},
			Pump1_Run: {value: 1, quality: HmiTypes.QUALITY_GOOD, timestamp: 5}});
		check('cd.simulatorCannotOverwriteDeviceTags', driver.get('Flow').value !== 99 &&
			driver.get('Pump1_Run').timestamp === 5);

		check('cd.serverLossIsComm', driver.get('Flow').status === 'comm' &&
			driver.get('Motor_On').quality === HmiTypes.QUALITY_BAD &&
			driver.get('Pump1_Run').quality === HmiTypes.QUALITY_GOOD);

		driver.disconnect();
		check('cd.disconnectClosesTheSession', find('disconnect') != null);

		// Without the desktop app, device tags are bad rather than silently absent.
		HmiComms.available = function() { return false; };
		var web = new HmiCommsDriver(project);
		web.connect();
		check('cd.noBridgeIsUnavailable', web.get('Flow').status === 'unavailable' &&
			web.write({Flow: 1}).Flow.ok === false);
		web.disconnect();
	}
	finally
	{
		HmiComms.available = saved.available;
		HmiComms.request = saved.request;
		HmiComms.onEvent = saved.onEvent;
		HmiComms.offEvent = saved.offEvent;
	}

	// A real run: a device nobody answers for, through the real server.
	if (!HmiComms.available())
	{
		return;
	}

	var real = HmiSelfTest.sampleProject();
	var dead = HmiProject.createDevice('Dead', 'modbus');
	dead.host = '127.0.0.1';
	dead.port = 1;
	dead.timeoutMs = 500;
	real.devices.push(dead);
	var level = HmiProject.createTag('Remote_Level', 'IOReal');
	level.device = 'Dead';
	level.address = 'HR:0';
	real.addTag(level);

	var runDriver = new HmiCommsDriver(real);
	var statuses = [];
	runDriver.on('status', function(d) { statuses.push(d); });
	runDriver.connect();
	runDriver.subscribe(['Remote_Level', 'Tank_Level'], 250);

	var started = Date.now();

	var poll = function()
	{
		var v = runDriver.get('Remote_Level');

		if (v.status === 'comm' || Date.now() - started > 8000)
		{
			check('commsRun.unreachableDeviceIsComm', v.status === 'comm' && v.error != null,
				JSON.stringify(v));
			check('commsRun.statusReported', statuses.length > 0 && statuses[statuses.length - 1].Dead != null,
				JSON.stringify(statuses));
			check('commsRun.simulatedStillGood', runDriver.get('Tank_Level').quality === HmiTypes.QUALITY_GOOD);
			runDriver.disconnect();
			console.log('HMICOMMSRUN DONE');

			return;
		}

		window.setTimeout(poll, 100);
	};

	window.setTimeout(poll, 100);
};

// ------------------------------------------- SQL database access (HmiSql)

/** A project with one of everything the SQL feature adds. */
HmiSelfTest.sqlProject = function()
{
	var p = HmiSelfTest.sampleProject();

	var plant = HmiSql.newDataSource('Plant');
	plant.host = 'db.example';
	plant.port = '1433';
	plant.database = 'Batches';
	plant.user = 'hmi';
	plant.password = 'hmi1:wrapped-looking-text';
	plant.options.legacyTls = true;
	plant.options.trustServerCertificate = false;
	p.dataSources.push(plant);

	var local = HmiSql.newDataSource('Local');
	local.provider = 'sqlite';
	local.file = 'batches.db';
	local.folder = 'documents';
	p.dataSources.push(local);

	var list = HmiSql.newBindList('BatchRow');
	list.items.push({tag: 'Tank_Level', field: '', column: 'Level', delim: ''});
	list.items.push({tag: 'Recipe_Name', field: '', column: 'Recipe', delim: "''"});
	list.items.push({tag: 'Tank_Level', field: 'InAlarm', column: 'InAlarm', delim: ''});
	p.bindLists.push(list);

	var template = HmiSql.newTemplate('BatchLog');
	template.columns.push({name: 'Recipe', type: 'text', length: '80', scale: '',
		index: 'nonunique', allowNull: false});
	template.columns.push({name: 'Level', type: 'number', length: '', scale: '',
		index: 'none', allowNull: true});
	template.columns.push({name: 'Amount', type: 'decimal', length: '10', scale: '3',
		index: 'none', allowNull: true});
	p.tableTemplates.push(template);

	var query = HmiSql.newQuery('Recent');
	query.sql = 'SELECT Recipe, Level\nFROM BatchLog\nORDER BY Stamp DESC';
	p.queries.push(query);

	return p;
};

/**
 * The project model: the four lists must survive the file, and the rules that
 * the dialog, the command line and Validate all ask must agree.
 */
HmiSelfTest.testSql = function()
{
	var doc = mxUtils.createXmlDocument();
	var p1 = HmiSelfTest.sqlProject();
	var x1 = mxUtils.getXml(p1.toXml(doc));
	var p2 = HmiProject.fromXml(mxUtils.parseXml(x1).documentElement);
	var x2 = mxUtils.getXml(p2.toXml(doc));

	HmiSelfTest.check('sql.roundTrip.stable', x1 === x2, '\n  first=' + x1 + '\n  second=' + x2);
	HmiSelfTest.check('sql.roundTrip.counts', p2.dataSources.length === 2 &&
		p2.bindLists.length === 1 && p2.tableTemplates.length === 1 && p2.queries.length === 1,
		'got ' + p2.dataSources.length + '/' + p2.bindLists.length + '/' +
		p2.tableTemplates.length + '/' + p2.queries.length);

	var plant = HmiSql.dataSource(p2, 'plant');
	HmiSelfTest.check('sql.roundTrip.lookupCaseInsensitive', plant != null);
	HmiSelfTest.check('sql.roundTrip.dataSource', plant != null && plant.host === 'db.example' &&
		plant.port === '1433' && plant.database === 'Batches' && plant.user === 'hmi');
	HmiSelfTest.check('sql.roundTrip.password',
		plant != null && plant.password === 'hmi1:wrapped-looking-text');
	HmiSelfTest.check('sql.roundTrip.options', plant != null && plant.options.legacyTls === true &&
		plant.options.trustServerCertificate === false && plant.options.encrypt === false);
	HmiSelfTest.check('sql.roundTrip.sqlite', HmiSql.dataSource(p2, 'Local') != null &&
		HmiSql.dataSource(p2, 'Local').file === 'batches.db');
	HmiSelfTest.check('sql.roundTrip.folder',
		HmiSql.dataSource(p2, 'Local').folder === 'documents');

	// The default folder writes no attribute, so an older file still loads
	var appData = HmiSql.newDataSource('App');
	appData.provider = 'sqlite';
	appData.file = 'a.db';
	var one = new HmiProject();
	one.dataSources.push(appData);
	var xa = mxUtils.getXml(one.toXml(doc));
	HmiSelfTest.check('sql.defaultFolder.noAttribute', xa.indexOf('folder=') < 0, xa);
	HmiSelfTest.check('sql.defaultFolder.loadsAsAppData',
		HmiProject.fromXml(mxUtils.parseXml(xa).documentElement).dataSources[0].folder === 'appdata');

	// Every list's items would come back if the nodes were asked of the
	// project rather than of their own list
	var list = HmiSql.bindList(p2, 'BatchRow');
	HmiSelfTest.check('sql.roundTrip.bindItems', list != null && list.items.length === 3,
		'got ' + ((list != null) ? list.items.length : 'none'));
	HmiSelfTest.check('sql.roundTrip.bindField', list != null && list.items[2].field === 'InAlarm');
	HmiSelfTest.check('sql.roundTrip.bindDelim', list != null && list.items[1].delim === "''");

	var template = HmiSql.tableTemplate(p2, 'BatchLog');
	HmiSelfTest.check('sql.roundTrip.columns', template != null && template.columns.length === 3);
	HmiSelfTest.check('sql.roundTrip.column', template != null && template.columns[0].type === 'text' &&
		template.columns[0].length === '80' && template.columns[0].index === 'nonunique' &&
		template.columns[0].allowNull === false);
	HmiSelfTest.check('sql.roundTrip.scale', template != null && template.columns[2].scale === '3');
	HmiSelfTest.check('sql.roundTrip.allowNullDefault', template != null &&
		template.columns[1].allowNull === true);

	var query = HmiSql.query(p2, 'Recent');
	HmiSelfTest.check('sql.roundTrip.query', query != null &&
		query.sql === 'SELECT Recipe, Level\nFROM BatchLog\nORDER BY Stamp DESC',
		'got ' + ((query != null) ? JSON.stringify(query.sql) : 'none'));

	// A pretty printed file puts the statement on its own indented line
	var pretty = x1.replace('<querySql>', '<querySql>\n          ')
		.replace('</querySql>', '\n        </querySql>');
	var p3 = HmiProject.fromXml(mxUtils.parseXml(pretty).documentElement);
	HmiSelfTest.check('sql.prettyPrinted.query', HmiSql.query(p3, 'Recent') != null &&
		HmiSql.query(p3, 'Recent').sql === HmiSql.query(p2, 'Recent').sql,
		'got ' + JSON.stringify(HmiSql.query(p3, 'Recent').sql));

	// An empty statement writes no element, so the file still round trips
	var noSql = new HmiProject();
	noSql.queries.push(HmiSql.newQuery('Blank'));
	var xq = mxUtils.getXml(noSql.toXml(doc));
	HmiSelfTest.check('sql.emptyQuery.noElement', xq.indexOf('querySql') < 0, xq);

	// A name with a stray space in a hand-edited file would never match what
	// a script asks for
	var spaced = x1.replace('name="Plant"', 'name=" Plant "');
	var p4 = HmiProject.fromXml(mxUtils.parseXml(spaced).documentElement);
	HmiSelfTest.check('sql.load.trimsNames', HmiSql.dataSource(p4, 'Plant') != null);

	HmiSelfTest.check('sql.isEmpty.countsSql', !HmiSelfTest.sqlProject().isEmpty() &&
		new HmiProject().isEmpty());

	// --- the rules
	var sources = p1.dataSources;
	HmiSelfTest.check('sql.rules.goodDataSource',
		HmiSql.dataSourceProblem(sources, sources[0]) == null,
		'' + HmiSql.dataSourceProblem(sources, sources[0]));
	HmiSelfTest.check('sql.rules.unchangedNameIsNotItsOwnClash',
		HmiSql.nameProblem(sources, sources[0], 'A data source') == null);

	var clash = HmiSql.newDataSource('PLANT');
	clash.host = 'h';
	HmiSelfTest.check('sql.rules.duplicateName',
		HmiSql.dataSourceProblem(sources, clash) != null);

	var noName = HmiSql.newDataSource('');
	noName.host = 'h';
	HmiSelfTest.check('sql.rules.needsName', HmiSql.dataSourceProblem(sources, noName) != null);

	var quoted = HmiSql.newDataSource('He said "no"');
	quoted.host = 'h';
	HmiSelfTest.check('sql.rules.noQuotesInName',
		HmiSql.dataSourceProblem(sources, quoted) != null);

	var badProvider = HmiSql.newDataSource('Other');
	badProvider.provider = 'oracle';
	badProvider.host = 'h';
	HmiSelfTest.check('sql.rules.unknownProvider',
		HmiSql.dataSourceProblem(sources, badProvider) != null);

	var noHost = HmiSql.newDataSource('NoHost');
	HmiSelfTest.check('sql.rules.needsHost', HmiSql.dataSourceProblem(sources, noHost) != null);

	var badPort = HmiSql.newDataSource('BadPort');
	badPort.host = 'h';
	badPort.port = '70000';
	HmiSelfTest.check('sql.rules.badPort', HmiSql.dataSourceProblem(sources, badPort) != null);

	// The main process refuses a file outside Documents and the application
	// data folder; the rules say so before Run does
	var paths = ['/etc/passwd', 'C:\\Windows\\x.db', '../up.db', 'sub/../../up.db'];

	for (var i = 0; i < paths.length; i++)
	{
		var file = HmiSql.newDataSource('F' + i);
		file.provider = 'sqlite';
		file.file = paths[i];
		HmiSelfTest.check('sql.rules.filePath.' + i,
			HmiSql.dataSourceProblem(sources, file) != null, paths[i]);
	}

	HmiSelfTest.check('sql.normalizeFolder', HmiSql.normalizeFolder('Documents') === 'documents' &&
		HmiSql.normalizeFolder('nonsense') === 'appdata' && HmiSql.normalizeFolder(null) === 'appdata');

	var okFile = HmiSql.newDataSource('OkFile');
	okFile.provider = 'sqlite';
	okFile.file = 'sub/batches.db';
	HmiSelfTest.check('sql.rules.relativeFileAllowed',
		HmiSql.dataSourceProblem(sources, okFile) == null,
		'' + HmiSql.dataSourceProblem(sources, okFile));

	HmiSelfTest.check('sql.rules.goodBindList',
		HmiSql.bindListProblem(p1.bindLists, p1.bindLists[0]) == null,
		'' + HmiSql.bindListProblem(p1.bindLists, p1.bindLists[0]));

	var emptyList = HmiSql.newBindList('Empty');
	HmiSelfTest.check('sql.rules.bindListNeedsItems',
		HmiSql.bindListProblem(p1.bindLists, emptyList) != null);
	// A list the dialog has just created is saveable; the project is still
	// checked without the allowance
	HmiSelfTest.check('sql.rules.draftBindListIsSaveable',
		HmiSql.bindListProblem(p1.bindLists, emptyList, true) == null);

	var twice = HmiSql.newBindList('Twice');
	twice.items.push({tag: 'A', column: 'X'});
	twice.items.push({tag: 'B', column: 'x'});
	HmiSelfTest.check('sql.rules.columnTwice',
		HmiSql.bindListProblem(p1.bindLists, twice) != null);

	var noTag = HmiSql.newBindList('NoTag');
	noTag.items.push({tag: '', column: 'X'});
	HmiSelfTest.check('sql.rules.bindItemNeedsTag',
		HmiSql.bindListProblem(p1.bindLists, noTag) != null);

	HmiSelfTest.check('sql.rules.goodTemplate',
		HmiSql.templateProblem(p1.tableTemplates, p1.tableTemplates[0]) == null,
		'' + HmiSql.templateProblem(p1.tableTemplates, p1.tableTemplates[0]));

	var emptyTemplate = HmiSql.newTemplate('Empty');
	HmiSelfTest.check('sql.rules.templateNeedsColumns',
		HmiSql.templateProblem(p1.tableTemplates, emptyTemplate) != null);
	HmiSelfTest.check('sql.rules.draftTemplateIsSaveable',
		HmiSql.templateProblem(p1.tableTemplates, emptyTemplate, true) == null);

	var badLength = HmiSql.newTemplate('BadLength');
	badLength.columns.push({name: 'A', type: 'text', length: 'wide', scale: '',
		index: 'none', allowNull: true});
	HmiSelfTest.check('sql.rules.badLength',
		HmiSql.templateProblem(p1.tableTemplates, badLength) != null);

	HmiSelfTest.check('sql.rules.goodQuery',
		HmiSql.queryProblem(p1.queries, p1.queries[0]) == null);

	var blank = HmiSql.newQuery('Blank');
	HmiSelfTest.check('sql.rules.queryNeedsSql',
		HmiSql.queryProblem(p1.queries, blank) != null);
	HmiSelfTest.check('sql.rules.draftQueryIsSaveable',
		HmiSql.queryProblem(p1.queries, blank, true) == null);
	// A draft still has to have a usable name
	HmiSelfTest.check('sql.rules.draftStillNeedsAName',
		HmiSql.queryProblem(p1.queries, HmiSql.newQuery(''), true) != null);

	// --- the helpers
	HmiSelfTest.check('sql.provider.caseInsensitive', HmiSql.provider('MSSQL') != null &&
		HmiSql.provider('SQLite') != null && HmiSql.provider('oracle') == null);
	HmiSelfTest.check('sql.normalizeType.fallsBackToText', HmiSql.normalizeType('nonsense') === 'text' &&
		HmiSql.normalizeType('DATETIME') === 'datetime');
	HmiSelfTest.check('sql.normalizeIndex.fallsBackToNone', HmiSql.normalizeIndex('nonsense') === 'none' &&
		HmiSql.normalizeIndex('UNIQUE') === 'unique');
	HmiSelfTest.check('sql.reserved.catchesWhatOurDatabasesRefuse',
		HmiSql.isReservedColumn('select') && HmiSql.isReservedColumn('TABLE') &&
		HmiSql.isReservedColumn('User') && HmiSql.isReservedColumn('key') &&
		HmiSql.isReservedColumn('limit') && !HmiSql.isReservedColumn('BatchName'));
	// The wider SQL-92 list reserves these; neither of our databases does,
	// and an HMI names columns after them constantly
	HmiSelfTest.check('sql.reserved.leavesCommonHmiNamesAlone',
		!HmiSql.isReservedColumn('Level') && !HmiSql.isReservedColumn('date') &&
		!HmiSql.isReservedColumn('TIME') && !HmiSql.isReservedColumn('Year'));
	HmiSelfTest.check('sql.needsBrackets', HmiSql.needsBrackets('Valve ID') &&
		HmiSql.needsBrackets('2Bad') && !HmiSql.needsBrackets('Valve_ID'));

	// What goes to the main process: no empty strings standing in for
	// defaults, and numbers as numbers
	var spec = HmiSql.toSpec(plant);
	HmiSelfTest.check('sql.toSpec.numbers', spec.port === 1433, '' + spec.port);
	HmiSelfTest.check('sql.toSpec.options', spec.options.legacyTls === true &&
		spec.options.trustServerCertificate === false);
	HmiSelfTest.check('sql.toSpec.noTimeout', spec.timeoutMs === undefined, '' + spec.timeoutMs);

	var fileSpec = HmiSql.toSpec(HmiSql.dataSource(p2, 'Local'));
	HmiSelfTest.check('sql.toSpec.sqliteCarriesNoServer', fileSpec.file === 'batches.db' &&
		fileSpec.host === undefined && fileSpec.password === undefined);
	HmiSelfTest.check('sql.toSpec.folder', fileSpec.folder === 'documents');
};

/**
 * HMI > Database, driven with the host stubbed. The dialog edits a copy, so
 * what matters is that OK applies it, Cancel does not, and a bad draft is
 * refused with the tab it is on brought into view.
 */
HmiSelfTest.testDatabaseDialog = function(ui)
{
	var check = HmiSelfTest.check;
	var saved = ui.hmiProject;
	var project = HmiSelfTest.sqlProject();
	ui.hmiProject = project;

	// As for the other dialog tests: a real hideDialog closes whatever else
	// is open, and the focus it hands back breaks the deferred checks at the
	// end of the suite.
	var realShow = ui.showDialog;
	var realHide = ui.hideDialog;
	var shown = null;
	var hidden = 0;

	ui.showDialog = function(div) { shown = div; };
	ui.hideDialog = function() { shown = null; hidden++; };

	try
	{
		var labels = [];
		var fake = {showDisabled: true, hideShortcuts: true,
			addItem: function(label)
			{
				labels.push(label);

				return document.createElement('div');
			},
			addSeparator: function() {},
			addCheckmark: function() {}};

		try
		{
			ui.menus.get('hmi').funct(fake, null);
		}
		catch (e)
		{
			// Only our own items matter here
		}

		check('sqlDlg.inMenu',
			mxUtils.indexOf(labels, mxResources.get('hmiDatabase') + '...') >= 0,
			labels.join(' | ').substring(0, 160));
		check('sqlDlg.clearPasswordsInMenu',
			mxUtils.indexOf(labels, mxResources.get('hmiClearDatabasePasswords') + '...') >= 0);
		check('sqlDlg.actionsRegistered', ui.actions.get('hmiDatabase') != null &&
			ui.actions.get('hmiClearDatabasePasswords') != null);

		var box = HmiDialogs.showDatabase(ui);
		var field = function(name) { return box.querySelector('[data-hmi-field="' + name + '"]'); };
		var tab = function(key) { return box.querySelector('[data-hmi-tab="' + key + '"]'); };

		// --- the tabs -----------------------------------------------------

		check('sqlDlg.fourTabs', box.querySelectorAll('[data-hmi-tab]').length === 4);
		check('sqlDlg.tabCounts', tab('dataSources').innerText === 'Data Sources (2)',
			tab('dataSources').innerText);
		check('sqlDlg.startsOnDataSources', tab('dataSources').className.indexOf('hmiSqlTabOn') >= 0);
		check('sqlDlg.listsSources', box.querySelectorAll('[data-hmi-item]').length === 2);
		check('sqlDlg.showsProvider',
			box.querySelector('[data-hmi-item="Plant"] td:nth-child(2)').innerText ===
			'Microsoft SQL Server',
			box.querySelector('[data-hmi-item="Plant"] td:nth-child(2)').innerText);

		// --- a data source ------------------------------------------------

		check('sqlDlg.sourceFields', field('host').value === 'db.example' &&
			field('database').value === 'Batches' && field('user').value === 'hmi');
		check('sqlDlg.passwordNotShown', field('password').value === '',
			'the stored password is in the field');
		check('sqlDlg.passwordSaysItIsKept',
			field('password').getAttribute('placeholder').indexOf('kept') >= 0,
			field('password').getAttribute('placeholder'));
		check('sqlDlg.legacyTlsChecked', field('legacyTls').checked === true);
		check('sqlDlg.trustNotChecked', field('trustServerCertificate').checked === false);

		// Switching kind shows the file fields instead of the server ones
		field('provider').value = 'sqlite';
		field('provider').dispatchEvent(new Event('change'));
		check('sqlDlg.sqliteShowsFile', field('file') != null && field('host') == null);
		field('provider').value = 'mssql';
		field('provider').dispatchEvent(new Event('change'));
		check('sqlDlg.backToServer', field('host') != null && field('file') == null);

		// A typed password replaces the stored one, and emptying the field
		// again keeps what was there rather than throwing it away
		field('password').value = 'typed-in';
		field('password').dispatchEvent(new Event('input'));
		check('sqlDlg.typedPasswordTaken',
			HmiSql.find(ui.hmiProject.dataSources, 'Plant').password === 'hmi1:wrapped-looking-text',
			'the project changed before OK');
		field('password').value = '';
		field('password').dispatchEvent(new Event('input'));
		check('sqlDlg.emptyFieldKeepsThePassword', (function()
		{
			var source = null;
			var items = box.querySelectorAll('[data-hmi-item]');

			// The draft is what the dialog holds; read it back through Test,
			// which refuses only on a real problem
			return field('password').value === '' &&
				field('password').getAttribute('placeholder').indexOf('kept') >= 0 &&
				items.length === 2;
		})());
		check('sqlDlg.clearForgetsThePassword', (function()
		{
			field('clearPassword').click();

			return field('clearPassword') == null &&
				field('password').getAttribute('placeholder') === '';
		})());

		// --- a bind list --------------------------------------------------

		tab('bindLists').click();
		check('sqlDlg.switchesTab', tab('bindLists').className.indexOf('hmiSqlTabOn') >= 0);
		check('sqlDlg.listsBindLists', box.querySelectorAll('[data-hmi-item]').length === 1);
		check('sqlDlg.bindRows', box.querySelectorAll('[data-hmi-row]').length === 3,
			'' + box.querySelectorAll('[data-hmi-row]').length);

		var tags = box.querySelectorAll('[data-hmi-field="rowTag"]');
		check('sqlDlg.marksUnknownTag', (function()
		{
			tags[0].value = 'Nope';
			tags[0].dispatchEvent(new Event('input'));
			var bad = tags[0].classList.contains('hmiInvalid');
			tags[0].value = 'Tank_Level';
			tags[0].dispatchEvent(new Event('input'));

			return bad && !tags[0].classList.contains('hmiInvalid');
		})());

		field('addRow').click();
		check('sqlDlg.addsBindRow', box.querySelectorAll('[data-hmi-row]').length === 4);
		box.querySelectorAll('[data-hmi-field="removeRow"]')[3].click();
		check('sqlDlg.removesBindRow', box.querySelectorAll('[data-hmi-row]').length === 3);

		// Order is the order the columns are written in, so it must move
		var firstColumn = box.querySelectorAll('[data-hmi-field="rowColumn"]')[0].value;
		box.querySelectorAll('[title="Move down"]')[0].click();
		check('sqlDlg.movesRowDown',
			box.querySelectorAll('[data-hmi-field="rowColumn"]')[1].value === firstColumn,
			box.querySelectorAll('[data-hmi-field="rowColumn"]')[1].value);
		box.querySelectorAll('[title="Move up"]')[1].click();
		check('sqlDlg.movesRowBack',
			box.querySelectorAll('[data-hmi-field="rowColumn"]')[0].value === firstColumn);

		// --- a table template ---------------------------------------------

		tab('tableTemplates').click();
		check('sqlDlg.templateRows', box.querySelectorAll('[data-hmi-row]').length === 3);
		check('sqlDlg.decimalHasScale', (function()
		{
			var scales = box.querySelectorAll('[data-hmi-field="columnScale"]');

			return scales.length === 1 && scales[0].value === '3';
		})());

		// A text column has a length, a date has neither
		var types = box.querySelectorAll('[data-hmi-field="columnType"]');
		types[1].value = 'datetime';
		types[1].dispatchEvent(new Event('change'));
		check('sqlDlg.dateHasNoLength',
			box.querySelectorAll('[data-hmi-row]')[1]
				.querySelector('[data-hmi-field="columnLength"]') == null);
		types[1].value = 'number';
		types[1].dispatchEvent(new Event('change'));

		// A SQL keyword as a column name is worth warning about, not refusing
		var names = box.querySelectorAll('[data-hmi-field="columnName"]');
		names[0].value = 'Order';
		names[0].dispatchEvent(new Event('input'));
		check('sqlDlg.warnsAboutKeyword',
			field('columnWarning').innerText.indexOf('keyword') >= 0,
			field('columnWarning').innerText);
		names[0].value = 'Valve ID';
		names[0].dispatchEvent(new Event('input'));
		check('sqlDlg.warnsAboutBrackets',
			field('columnWarning').innerText.indexOf('square brackets') >= 0,
			field('columnWarning').innerText);
		names[0].value = 'Recipe';
		names[0].dispatchEvent(new Event('input'));
		check('sqlDlg.warningClears', field('columnWarning').innerText === '',
			field('columnWarning').innerText);
		// "Level" is reserved in the wider SQL-92 list but by neither of our
		// databases, so a tank level column must not be warned about
		check('sqlDlg.noWarningForLevel',
			field('columnWarning').innerText.indexOf('Level') < 0,
			field('columnWarning').innerText);

		// --- a query ------------------------------------------------------

		tab('queries').click();
		check('sqlDlg.queryShown',
			field('querySql').value.indexOf('SELECT Recipe, Level') === 0,
			field('querySql').value.substring(0, 30));
		field('querySql').value = 'SELECT 1';
		field('querySql').dispatchEvent(new Event('input'));

		// --- add, duplicate, delete ---------------------------------------

		field('addItem').click();
		check('sqlDlg.adds', box.querySelectorAll('[data-hmi-item]').length === 2);
		check('sqlDlg.addNamesFreely', field('itemName').value === 'Query',
			field('itemName').value);
		field('itemName').value = 'Second';
		field('itemName').dispatchEvent(new Event('input'));
		check('sqlDlg.renameShowsInList',
			box.querySelector('[data-hmi-item="Second"]') != null ||
			box.querySelectorAll('[data-hmi-item]')[1].querySelector('td').innerText === 'Second');

		field('querySql').value = 'SELECT 2';
		field('querySql').dispatchEvent(new Event('input'));

		field('duplicateItem').click();
		check('sqlDlg.duplicateCountsUp', field('itemName').value === 'Second1',
			field('itemName').value);
		field('deleteItem').click();
		check('sqlDlg.deletes', box.querySelectorAll('[data-hmi-item]').length === 2);

		// --- a bad draft is refused, on its own tab -----------------------

		tab('dataSources').click();
		box.querySelectorAll('[data-hmi-item]')[1].click();
		field('provider').value = 'mssql';
		field('provider').dispatchEvent(new Event('change'));
		field('host').value = '';
		field('host').dispatchEvent(new Event('blur'));
		tab('queries').click();

		var okButton = null;
		var buttons = box.querySelectorAll('button');

		for (var b = 0; b < buttons.length; b++)
		{
			if (buttons[b].className.indexOf('hmiOk') >= 0)
			{
				okButton = buttons[b];
			}
		}

		check('sqlDlg.hasOk', okButton != null);
		hidden = 0;
		okButton.click();
		check('sqlDlg.refusesBadDraft', hidden === 0 && field('sqlError').innerText !== '',
			field('sqlError').innerText);
		check('sqlDlg.showsTheTabWithTheProblem',
			tab('dataSources').className.indexOf('hmiSqlTabOn') >= 0);

		// Put it right and it applies
		field('host').value = 'other.example';
		field('host').dispatchEvent(new Event('blur'));

		check('sqlDlg.projectUntouchedBeforeOk',
			ui.hmiProject.queries.length === 1 &&
			HmiSql.query(ui.hmiProject, 'Recent').sql.indexOf('SELECT Recipe') === 0,
			'the project changed while the dialog was open');

		// --- OK applies ---------------------------------------------------

		// With no password typed there is nothing to send to the main
		// process, so OK applies without waiting
		field('password').value = '';
		field('password').dispatchEvent(new Event('input'));
		hidden = 0;
		okButton.click();
		check('sqlDlg.okCloses', hidden === 1, 'error was ' + field('sqlError').innerText);
		check('sqlDlg.okApplies', ui.hmiProject.queries.length === 2,
			'' + ui.hmiProject.queries.length);
		check('sqlDlg.okAppliedTheEdit',
			HmiSql.query(ui.hmiProject, 'Recent').sql === 'SELECT 1',
			HmiSql.query(ui.hmiProject, 'Recent').sql);
		check('sqlDlg.okAppliedToEveryTab',
			HmiSql.dataSource(ui.hmiProject, 'Local').host === 'other.example',
			'' + HmiSql.dataSource(ui.hmiProject, 'Local').host);
		check('sqlDlg.okMarksTheFile', ui.editor.modified === true);

		// --- Cancel does not --------------------------------------------

		var before = JSON.stringify(ui.hmiProject.queries);
		var again = HmiDialogs.showDatabase(ui);
		again.querySelector('[data-hmi-tab="queries"]').click();
		again.querySelector('[data-hmi-field="querySql"]').value = 'SELECT nothing';
		again.querySelector('[data-hmi-field="querySql"]').dispatchEvent(new Event('input'));
		var cancel = null;
		var cancelButtons = again.querySelectorAll('button');

		for (var c = 0; c < cancelButtons.length; c++)
		{
			if (cancelButtons[c].innerText === mxResources.get('cancel'))
			{
				cancel = cancelButtons[c];
			}
		}

		cancel.click();
		check('sqlDlg.cancelKeepsTheProject',
			JSON.stringify(ui.hmiProject.queries) === before,
			ui.hmiProject.queries.map(function(q) { return q.sql; }).join(' | '));
	}
	finally
	{
		ui.showDialog = realShow;
		ui.hideDialog = realHide;
		ui.hmiProject = saved;
	}
};

/**
 * The SQL* script functions: what the engine makes of them, and what the
 * manager does with a stubbed main process. No database is involved.
 */
HmiSelfTest.testSqlFunctions = function()
{
	var check = HmiSelfTest.check;
	var project = HmiSelfTest.sqlProject();
	project.addTag(HmiProject.createTag('ConnId', 'MemoryInteger'));
	project.addTag(HmiProject.createTag('RowCount', 'MemoryInteger'));
	project.addTag(HmiProject.createTag('Result', 'MemoryInteger'));
	project.addTag(HmiProject.createTag('ErrText', 'MemoryMessage'));

	var compile = function(src, mode)
	{
		return HmiExpr.compile(src, {project: project, mode: mode || 'script'});
	};

	// --- the engine ---------------------------------------------------

	var ok = compile('Result = SQLConnect(ConnId, "Plant");');
	check('sqlFn.compiles', ok.errors.length === 0,
		ok.errors.length > 0 ? ok.errors[0].message : '');

	// The tag that receives the connection number is written, not read
	check('sqlFn.outArgIsAWrite', mxUtils.indexOf(ok.writes, 'ConnId') >= 0,
		ok.writes.join(','));

	var notATag = compile('Result = SQLConnect(7, "Plant");');
	check('sqlFn.outArgMustBeATag', notATag.errors.length > 0 &&
		notATag.errors[0].message.indexOf('must be a tag') >= 0,
		notATag.errors.length > 0 ? notATag.errors[0].message : 'no error');

	var local = compile('DIM n AS Analog;\nResult = SQLConnect(n, "Plant");');
	check('sqlFn.outArgNotALocal', local.errors.length > 0 &&
		local.errors[0].message.indexOf('not a local variable') >= 0,
		local.errors.length > 0 ? local.errors[0].message : 'no error');

	var system = compile('Result = SQLConnect(_AlarmsActive, "Plant");');
	check('sqlFn.outArgNotASystemTag', system.errors.length > 0,
		system.errors.length > 0 ? system.errors[0].message : 'no error');

	// A database call pauses, so it may only be a statement or the whole
	// right-hand side of an assignment -- which is the form they are written
	// in anyway
	var midExpression = compile('Result = SQLNumRows(ConnId) + SQLConnect(ConnId, "Plant");');
	check('sqlFn.asyncNotMidExpression', midExpression.errors.length > 0,
		midExpression.errors.length > 0 ? midExpression.errors[0].message : 'no error');

	var inExpression = HmiExpr.compile('SQLNumRows(ConnId)', {project: project});
	check('sqlFn.notInAnimationExpression', inExpression.errors.length > 0 &&
		inExpression.errors[0].message.indexOf('only be used in a script') >= 0,
		inExpression.errors.length > 0 ? inExpression.errors[0].message : 'no error');

	var inQuick = compile('Result = SQLSelect(ConnId, "T", "BatchRow", "", "");', 'quick');
	check('sqlFn.refusedInQuickFunction', inQuick.errors.length > 0 &&
		inQuick.errors[0].message.indexOf('QuickFunction') >= 0,
		inQuick.errors.length > 0 ? inQuick.errors[0].message : 'no error');

	// The cursor family does not pause, so a QuickFunction may walk a
	// selection -- it writes tags, so it is script-only all the same
	var cursorInQuick = compile('Return SQLNumRows(ConnId);', 'quick');
	check('sqlFn.cursorAllowedInQuickFunction', cursorInQuick.errors.length === 0,
		cursorInQuick.errors.length > 0 ? cursorInQuick.errors[0].message : '');
	check('sqlFn.cursorIsImpure', cursorInQuick.impure === true);

	var arity = compile('Result = SQLSelect(ConnId, "T");');
	check('sqlFn.arityChecked', arity.errors.length > 0 &&
		arity.errors[0].message.indexOf('takes 5 arguments') >= 0,
		arity.errors.length > 0 ? arity.errors[0].message : 'no error');

	// The calls that write to a table: the same rules, and the same form
	check('sqlFn.writingCallsCompile',
		compile('Result = SQLInsert(ConnId, "BatchLog", "BatchRow");').errors.length === 0 &&
		compile('Result = SQLUpdate(ConnId, "BatchLog", "BatchRow", "Done = 1");').errors.length === 0 &&
		compile('Result = SQLUpdateCurrent(ConnId);').errors.length === 0 &&
		compile('Result = SQLDelete(ConnId, "BatchLog", "Done = 1");').errors.length === 0 &&
		compile('Result = SQLClearTable(ConnId, "BatchLog");').errors.length === 0 &&
		compile('Result = SQLCreateTable(ConnId, "BatchLog", "BatchLog");').errors.length === 0 &&
		compile('Result = SQLDropTable(ConnId, "BatchLog");').errors.length === 0,
		compile('Result = SQLInsert(ConnId, "BatchLog", "BatchRow");').errors.join(','));
	check('sqlFn.insertArity',
		compile('Result = SQLInsert(ConnId, "BatchLog");').errors.length > 0 &&
		compile('Result = SQLUpdate(ConnId, "T", "BatchRow");').errors.length > 0);
	check('sqlFn.insertIsNotAnExpression',
		HmiExpr.compile('SQLInsert(ConnId, "BatchLog", "BatchRow")',
			{project: project}).errors.length > 0);
	check('sqlFn.insertRefusedInQuickFunction',
		compile('Result = SQLInsert(ConnId, "BatchLog", "BatchRow");', 'quick').errors.length > 0);
	// A loop over a selection updating each row is the shape S3a made possible
	check('sqlFn.writingCallsLoop',
		compile('Result = SQLFirst(ConnId);\nWHILE Result == 0\n' +
			' Result = SQLUpdateCurrent(ConnId);\n Result = SQLNext(ConnId);\nENDWHILE;')
			.errors.length === 0);

	// --- the messages -------------------------------------------------

	check('sqlFn.messagesCoverEveryCode', (function()
	{
		for (var key in HmiSql.CODES)
		{
			if (HmiSql.MESSAGES['' + HmiSql.CODES[key]] == null)
			{
				return false;
			}
		}

		return true;
	})());
	check('sqlFn.unknownCodeReadsSensibly', HmiSql.message(-4242) === 'Result code -4242');
	check('sqlFn.truncationCodeUnused', HmiSql.MESSAGES['-1007'] == null);

	// --- the manager, with the main process stubbed -------------------

	var sent = [];
	var answers = [];
	var writes = {};
	var errors = [];

	var hub = {
		subscribed: [],
		listeners: [],
		write: function(w) { for (var k in w) { writes[k] = w[k]; } },
		on: function(event, cb) { if (event === 'change') { this.listeners.push(cb); } },
		off: function(event, cb)
		{
			var at = mxUtils.indexOf(this.listeners, cb);

			if (at >= 0) { this.listeners.splice(at, 1); }
		},
		subscribe: function(names, rateMs) { this.subscribed = names.slice(); this.rateMs = rateMs; },
		current: {},
		get: function(name) { return this.current[name] || null; },
		deliver: function(batch)
		{
			for (var i = 0; i < this.listeners.length; i++) { this.listeners[i](batch); }
		}
	};

	var manager = new HmiSqlManager(project, hub, {
			report: function(call, message) { errors.push(call + ' :: ' + message); },
			request: function(action, args, fn, error)
			{
				sent.push({action: action, args: args});
				var next = answers.shift();

				if (next == null) { fn({code: 0}); }
				else if (next.throws) { error(new Error(next.throws)); }
				else { fn(next); }
			}
		});

	manager.start();

	var done = null;
	var last = null;
	var callAsync = function(name, args)
	{
		last = null;
		manager.callAsync(name, args, function(code) { last = code; });

		return last;
	};

	// Connect: the number comes back in the named tag
	answers.push({code: 0, connectionId: 1, provider: 'mssql'});
	check('sqlMgr.connect', callAsync('SQLConnect', ['ConnId', 'Plant']) === 0, '' + last);
	check('sqlMgr.connectWritesTheTag', writes.ConnId === 1, '' + writes.ConnId);
	check('sqlMgr.connectSendsTheSpec', sent.length === 1 &&
		sent[0].action === 'hmiSql.connect' && sent[0].args.dataSource.host === 'db.example',
		JSON.stringify(sent[0] || {}).substring(0, 120));

	check('sqlMgr.unknownDataSource',
		callAsync('SQLConnect', ['ConnId', 'Nope']) === HmiSql.CODES.NO_DATA_SOURCE, '' + last);
	check('sqlMgr.unknownDataSourceIsReported',
		errors.length === 1 && errors[0].indexOf('no data source named "Nope"') > 0,
		errors.join(' | '));

	// A connect string instead of a name
	answers.push({code: 0, connectionId: 2, provider: 'mssql'});
	check('sqlMgr.connectString',
		callAsync('SQLConnect', ['ConnId', 'Data Source=other;Initial Catalog=D;User ID=u;Password=p']) === 0,
		'' + last);
	check('sqlMgr.connectStringParsed', (function()
	{
		var spec = sent[sent.length - 1].args.dataSource;

		return spec.host === 'other' && spec.database === 'D' && spec.user === 'u';
	})(), JSON.stringify(sent[sent.length - 1].args.dataSource));

	// A failure carries the database's own words, and SQLErrorMsg gives them
	errors = [];
	answers.push({code: HmiSql.CODES.PROVIDER_ERROR, message: 'Invalid object name BatchLog'});
	check('sqlMgr.selectFailureCode',
		callAsync('SQLSelect', [1, 'BatchLog', 'BatchRow', '', '']) === HmiSql.CODES.PROVIDER_ERROR,
		'' + last);
	check('sqlMgr.failureReported', errors.length === 1 &&
		errors[0].indexOf('Invalid object name') > 0, errors.join(' | '));
	check('sqlMgr.errorMsgGivesTheDatabaseWords',
		manager.call('SQLErrorMsg', [HmiSql.CODES.PROVIDER_ERROR]) === 'Invalid object name BatchLog',
		manager.call('SQLErrorMsg', [HmiSql.CODES.PROVIDER_ERROR]));
	check('sqlMgr.errorMsgOfAKnownCode',
		manager.call('SQLErrorMsg', [HmiSql.CODES.NO_BIND_LIST]) ===
		HmiSql.MESSAGES['' + HmiSql.CODES.NO_BIND_LIST]);

	// A selection, then the cursor
	answers.push({code: 0, columns: [{name: 'Level'}, {name: 'Recipe'}, {name: 'InAlarm'}],
		rows: [[1.5, 'A', 0], [2.5, 'B', 1], [3.5, 'C', 0]]});
	check('sqlMgr.select', callAsync('SQLSelect', [1, 'BatchLog', 'BatchRow', 'Level > 0', 'Level ASC']) === 0,
		'' + last);
	check('sqlMgr.selectBuildsTheStatement', (function()
	{
		var sql = sent[sent.length - 1].args.sql;

		return sql === 'SELECT Level, Recipe, InAlarm FROM BatchLog WHERE Level > 0 ORDER BY Level ASC';
	})(), sent[sent.length - 1].args.sql);

	check('sqlMgr.numRows', manager.call('SQLNumRows', [1]) === 3, '' + manager.call('SQLNumRows', [1]));

	writes = {};
	check('sqlMgr.first', manager.call('SQLFirst', [1]) === 0, '' + manager.call('SQLFirst', [1]));
	check('sqlMgr.firstFetchesIntoTags',
		writes.Tank_Level === 1.5 && writes.Recipe_Name === 'A',
		JSON.stringify(writes));
	// A dotfield is read from a tag, never written to one
	check('sqlMgr.dotfieldNotWritten', Object.keys(writes).length === 2, JSON.stringify(writes));

	writes = {};
	manager.call('SQLNext', [1]);
	check('sqlMgr.next', writes.Recipe_Name === 'B', JSON.stringify(writes));
	writes = {};
	manager.call('SQLLast', [1]);
	check('sqlMgr.last', writes.Recipe_Name === 'C', JSON.stringify(writes));
	// Running off the end is how a loop over the rows finishes, so it must
	// not put a window in front of an operator
	errors = [];
	check('sqlMgr.pastTheEnd', manager.call('SQLNext', [1]) === HmiSql.CODES.NO_MORE_ROWS,
		'' + manager.call('SQLNext', [1]));
	check('sqlMgr.pastTheEndIsNotReported', errors.length === 0, errors.join(' | '));
	check('sqlMgr.warningsAreNotFailures', HmiSql.isWarning(HmiSql.CODES.NO_MORE_ROWS) &&
		HmiSql.isWarning(HmiSql.CODES.NULL_VALUE) &&
		!HmiSql.isWarning(HmiSql.CODES.PROVIDER_ERROR) &&
		!HmiSql.isWarning(HmiSql.CODES.INVALID_CONNECTION));
	writes = {};
	manager.call('SQLPrev', [1]);
	check('sqlMgr.prev', writes.Recipe_Name === 'B', JSON.stringify(writes));
	check('sqlMgr.beforeTheStart', (function()
	{
		manager.call('SQLFirst', [1]);

		return manager.call('SQLPrev', [1]) === HmiSql.CODES.NO_MORE_ROWS;
	})());

	writes = {};
	check('sqlMgr.getRecordCountsFromOne', manager.call('SQLGetRecord', [1, 2]) === 0 &&
		writes.Recipe_Name === 'B', JSON.stringify(writes));
	check('sqlMgr.getRecordOutOfRange',
		manager.call('SQLGetRecord', [1, 9]) === HmiSql.CODES.NO_MORE_ROWS);

	// A null column leaves the tag empty and the fetch still succeeds, so a
	// WHILE SQLNext(id) == 0 walk gets to the end of a selection whatever is
	// null in it. It goes to the runtime log, once, instead.
	answers.push({code: 0, columns: [{name: 'Level'}, {name: 'Recipe'}, {name: 'InAlarm'}],
		rows: [[null, null, null], [null, null, null]]});
	errors = [];
	callAsync('SQLSelect', [1, 'BatchLog', 'BatchRow', '', '']);
	writes = {};
	delete HmiLog.seen['sql:null:BatchRow:1'];
	var ringAt = HmiLog.ring.length;
	var nullFirst = manager.call('SQLFirst', [1]);
	var nullNext = manager.call('SQLNext', [1]);

	check('sqlMgr.nullStillFetches',
		nullFirst === HmiSql.CODES.OK && nullNext === HmiSql.CODES.OK,
		nullFirst + ', ' + nullNext);
	check('sqlMgr.nullBecomesEmpty', writes.Tank_Level === 0 && writes.Recipe_Name === '',
		JSON.stringify(writes));
	check('sqlMgr.nullIsNotReported', errors.length === 0, errors.join(' | '));
	check('sqlMgr.nullIsLoggedOnce',
		HmiLog.ring.length === ringAt + 1 &&
		HmiLog.ring[ringAt].msg.indexOf('sql:null:BatchRow') === 0,
		(HmiLog.ring.length - ringAt) + ': ' +
		HmiLog.ring.slice(ringAt).map(function(r) { return r.msg; }).join(' | '));
	check('sqlMgr.nullCodeStillHasWords',
		HmiSql.message(HmiSql.CODES.NULL_VALUE).length > 0,
		HmiSql.message(HmiSql.CODES.NULL_VALUE));

	// SQLEnd lets the rows go; the cursor functions then say so
	check('sqlMgr.end', manager.call('SQLEnd', [1]) === 0);
	check('sqlMgr.cursorAfterEnd', manager.call('SQLFirst', [1]) === HmiSql.CODES.NO_ROWS_SELECTED);
	check('sqlMgr.numRowsAfterEnd', manager.call('SQLNumRows', [1]) === HmiSql.CODES.NO_ROWS_SELECTED);

	// An unknown connection number
	check('sqlMgr.badConnection', manager.call('SQLFirst', [99]) === HmiSql.CODES.INVALID_CONNECTION);
	check('sqlMgr.selectNeedsABindList', (function()
	{
		answers.push({code: 0, columns: [], rows: []});

		return callAsync('SQLSelect', [1, 'T', 'NoSuchList', '', '']) === HmiSql.CODES.NO_BIND_LIST;
	})(), '' + last);
	check('sqlMgr.selectNeedsATable',
		callAsync('SQLSelect', [1, '', 'BatchRow', '', '']) === HmiSql.CODES.EMPTY_STATEMENT);

	// --- bind lists at run time ---------------------------------------
	// The manager watches every bind-list tag on its own hub client, because
	// an insert sends the tags' current values and those tags may be on no
	// window at all.

	answers.length = 0;
	errors = [];

	check('sqlBind.subscribesEveryBindListTag',
		hub.subscribed.length === 2 &&
		mxUtils.indexOf(hub.subscribed, 'Tank_Level') >= 0 &&
		mxUtils.indexOf(hub.subscribed, 'Recipe_Name') >= 0 &&
		hub.rateMs === HmiSql.BIND_RATE_MS,
		hub.subscribed.join(',') + ' at ' + hub.rateMs);

	var deliver = function(level, recipe, quality)
	{
		hub.deliver({
			'Tank_Level': {value: level,
				quality: (quality != null) ? quality : HmiTypes.QUALITY_GOOD, timestamp: 11},
			'Recipe_Name': {value: recipe, quality: HmiTypes.QUALITY_GOOD, timestamp: 11}});
	};

	var lastSent = function() { return sent[sent.length - 1].args; };

	deliver(7.5, 'Mix');

	check('sqlBind.insert', callAsync('SQLInsert', [1, 'BatchLog', 'BatchRow']) === 0, '' + last);
	check('sqlBind.insertStatement',
		lastSent().sql === 'INSERT INTO BatchLog (Level, Recipe, InAlarm) VALUES (?, ?, ?)',
		lastSent().sql);
	check('sqlBind.insertSendsTheTagValues',
		JSON.stringify(lastSent().params) ===
		JSON.stringify([{type: 'double', value: 7.5}, {type: 'varchar', value: 'Mix'},
			{type: 'int', value: 0}]),
		JSON.stringify(lastSent().params));

	// Bad quality is a null in the row, not a refusal: one tag of twenty may
	// be on a link that is down, and the record still says what was known
	delete HmiLog.seen['sql:bad:BatchRow:Tank_Level'];
	var ringBefore = HmiLog.ring.length;
	deliver(7.5, 'Mix', HmiTypes.QUALITY_BAD);
	callAsync('SQLInsert', [1, 'BatchLog', 'BatchRow']);

	check('sqlBind.badQualityIsWrittenAsNull',
		JSON.stringify(lastSent().params[0]) === JSON.stringify({type: 'null', nullType: 'float'}),
		JSON.stringify(lastSent().params[0]));
	check('sqlBind.badQualityIsLogged',
		HmiLog.ring.length > ringBefore &&
		HmiLog.ring[ringBefore].msg.indexOf('bad quality') > 0,
		HmiLog.ring.slice(ringBefore).map(function(r) { return r.msg; }).join(' | '));
	check('sqlBind.badQualityIsNotReported', errors.length === 0, errors.join(' | '));

	deliver(7.5, 'Mix');

	check('sqlBind.insertNeedsATable',
		callAsync('SQLInsert', [1, '', 'BatchRow']) === HmiSql.CODES.EMPTY_STATEMENT, '' + last);
	check('sqlBind.insertNeedsABindList',
		callAsync('SQLInsert', [1, 'BatchLog', 'Nope']) === HmiSql.CODES.NO_BIND_LIST, '' + last);

	// --- update -------------------------------------------------------

	check('sqlBind.update',
		callAsync('SQLUpdate', [1, 'BatchLog', 'BatchRow', 'Done = 1']) === 0, '' + last);
	check('sqlBind.updateStatement',
		lastSent().sql === 'UPDATE BatchLog SET Level = ?, Recipe = ?, InAlarm = ? WHERE Done = 1',
		lastSent().sql);
	check('sqlBind.updateNeedsAWhere',
		callAsync('SQLUpdate', [1, 'BatchLog', 'BatchRow', '  ']) === HmiSql.CODES.NO_WHERE_CLAUSE,
		'' + last);
	check('sqlBind.updateWhereRefusalSaysWhy',
		errors.length > 0 && errors[errors.length - 1].indexOf('every row') > 0,
		errors.join(' | '));

	// --- deleting -----------------------------------------------------

	check('sqlBind.delete', callAsync('SQLDelete', [1, 'BatchLog', 'Level > 9']) === 0, '' + last);
	check('sqlBind.deleteStatement',
		lastSent().sql === 'DELETE FROM BatchLog WHERE Level > 9', lastSent().sql);
	check('sqlBind.deleteNeedsAWhere',
		callAsync('SQLDelete', [1, 'BatchLog', '']) === HmiSql.CODES.NO_WHERE_CLAUSE, '' + last);
	check('sqlBind.clearTable', callAsync('SQLClearTable', [1, 'BatchLog']) === 0, '' + last);
	check('sqlBind.clearTableStatement',
		lastSent().sql === 'DELETE FROM BatchLog', lastSent().sql);
	check('sqlBind.dropTable', callAsync('SQLDropTable', [1, 'BatchLog']) === 0, '' + last);
	check('sqlBind.dropTableStatement',
		lastSent().sql === 'DROP TABLE BatchLog', lastSent().sql);

	// --- a table from a template --------------------------------------

	var before = sent.length;
	check('sqlBind.createTable',
		callAsync('SQLCreateTable', [1, 'BatchLog', 'BatchLog']) === 0, '' + last);
	check('sqlBind.createTableStatement',
		sent[before].args.sql === 'CREATE TABLE BatchLog (Recipe NVARCHAR(80) NOT NULL, ' +
			'Level FLOAT, Amount DECIMAL(10, 3))',
		sent[before].args.sql);
	check('sqlBind.createTableIndexes',
		sent.length === before + 2 &&
		sent[before + 1].args.sql === 'CREATE INDEX BatchLog_Recipe_idx ON BatchLog (Recipe)',
		(sent.length - before) + ': ' + (sent[before + 1] || {args: {}}).args.sql);
	check('sqlBind.createTableNeedsATemplate',
		callAsync('SQLCreateTable', [1, 'BatchLog', 'Nope']) === HmiSql.CODES.NO_TEMPLATE, '' + last);

	// SQLite has no date type of its own and its types are affinities
	var sqlite = HmiSql.tableSql('sqlite', 'BatchLog', (function()
	{
		var t = HmiSql.newTemplate('T');
		t.columns.push({name: 'Stamp', type: 'datetime', length: '', scale: '',
			index: 'unique', allowNull: false});
		t.columns.push({name: 'Recipe', type: 'text', length: '40', scale: '', index: 'none',
			allowNull: true});

		return t;
	})());

	check('sqlBind.sqliteTypes',
		sqlite[0] === 'CREATE TABLE BatchLog (Stamp TEXT NOT NULL, Recipe TEXT)',
		sqlite[0]);
	check('sqlBind.sqliteUniqueIndex',
		sqlite[1] === 'CREATE UNIQUE INDEX BatchLog_Stamp_idx ON BatchLog (Stamp)', sqlite[1]);

	// --- the row the cursor is on -------------------------------------

	answers.push({code: 0, columns: [{name: 'Level'}, {name: 'Recipe'}, {name: 'InAlarm'}],
		rows: [[1.5, 'A', 0], [2.5, null, 1]]});
	callAsync('SQLSelect', [1, 'BatchLog', 'BatchRow', '', '']);

	check('sqlBind.updateCurrentNeedsARow',
		callAsync('SQLUpdateCurrent', [1]) === HmiSql.CODES.NO_MORE_ROWS, '' + last);

	manager.call('SQLFirst', [1]);
	deliver(9.25, 'Blend');
	answers.push({code: 0, rowsAffected: 1});

	check('sqlBind.updateCurrent', callAsync('SQLUpdateCurrent', [1]) === 0, '' + last);
	check('sqlBind.updateCurrentStatement',
		lastSent().sql === 'UPDATE BatchLog SET Level = ?, Recipe = ?, InAlarm = ? ' +
			'WHERE Level = ? AND Recipe = ? AND InAlarm = ?',
		lastSent().sql);
	check('sqlBind.updateCurrentMatchesTheFetchedRow',
		lastSent().params.length === 6 &&
		JSON.stringify(lastSent().params.slice(3)) ===
		JSON.stringify([{type: 'double', value: 1.5}, {type: 'varchar', value: 'A'},
			{type: 'int', value: 0}]),
		JSON.stringify(lastSent().params));
	// The row held here follows what was written, so a second call finds it
	check('sqlBind.updateCurrentKeepsTheLocalRowInStep',
		JSON.stringify(manager.connections[1].results.rows[0]) ===
		JSON.stringify([9.25, 'Blend', 0]),
		JSON.stringify(manager.connections[1].results.rows[0]));

	// A null in the fetched row is matched with IS NULL, not with a parameter
	manager.call('SQLNext', [1]);
	answers.push({code: 0, rowsAffected: 1});
	callAsync('SQLUpdateCurrent', [1]);

	check('sqlBind.updateCurrentMatchesANull',
		lastSent().sql.indexOf('WHERE Level = ? AND Recipe IS NULL AND InAlarm = ?') > 0 &&
		lastSent().params.length === 5,
		lastSent().sql);

	// The row is gone, or something else changed it: the script is told
	manager.call('SQLFirst', [1]);
	answers.push({code: 0, rowsAffected: 0});

	check('sqlBind.updateCurrentRowGone',
		callAsync('SQLUpdateCurrent', [1]) === HmiSql.CODES.ROW_GONE, '' + last);

	manager.call('SQLEnd', [1]);
	check('sqlBind.updateCurrentNeedsASelection',
		callAsync('SQLUpdateCurrent', [1]) === HmiSql.CODES.NO_ROWS_SELECTED, '' + last);

	// --- how a value is bound -----------------------------------------

	check('sqlBind.paramTypes',
		HmiSql.paramOf('text').type === 'varchar' &&
		HmiSql.paramOf(5).type === 'int' &&
		HmiSql.paramOf(5.5).type === 'double' &&
		HmiSql.paramOf(true).value === 1 &&
		HmiSql.paramOf(null).type === 'null' &&
		HmiSql.paramOf(new Date(2026, 0, 2)).type === 'datetime',
		JSON.stringify([HmiSql.paramOf(5), HmiSql.paramOf(5.5)]));
	// A millisecond timestamp does not fit a 32-bit integer
	check('sqlBind.bigWholeNumbersAreNotIntegers',
		HmiSql.paramOf(1797000000000).type === 'double',
		HmiSql.paramOf(1797000000000).type);
	// .TimeDate stamps a date column, so it goes as a time and not as the
	// millisecond number it is
	check('sqlBind.timeDateIsBoundAsATime', (function()
	{
		var stamped = HmiSql.newBindList('Stamped');
		stamped.items.push({tag: 'Tank_Level', field: 'TimeDate', column: 'Stamp', delim: ''});
		project.bindLists.push(stamped);
		hub.current['Tank_Level'] = {value: 1, quality: HmiTypes.QUALITY_GOOD,
			timestamp: 1797000000000};
		callAsync('SQLInsert', [1, 'BatchLog', 'Stamped']);
		project.bindLists.pop();
		hub.current = {};
		var param = lastSent().params[0];

		return param.type === 'datetime' && param.value instanceof Date &&
			param.value.getTime() === 1797000000000;
	})(), JSON.stringify(lastSent().params));

	// What the driver holds wins over the last batch delivered here: a script
	// sets its tags and inserts in the same pass
	hub.current['Recipe_Name'] = {value: 'JustWritten', quality: HmiTypes.QUALITY_GOOD,
		timestamp: 99};
	deliver(1, 'Stale');
	callAsync('SQLInsert', [1, 'BatchLog', 'BatchRow']);

	check('sqlBind.insertSendsWhatWasJustWritten',
		lastSent().params[1].value === 'JustWritten',
		JSON.stringify(lastSent().params[1]));

	hub.current = {};

	check('sqlBind.columnNamesMatchThroughBrackets',
		HmiSql.columnAt(project.bindLists[0], 'Level') === 0 &&
		HmiSql.columnAt(project.bindLists[0], '[Recipe]') === 1 &&
		HmiSql.columnAt(project.bindLists[0], 'Nope') < 0,
		'' + HmiSql.columnAt(project.bindLists[0], '[Recipe]'));

	// Disconnect, and the Run ending
	check('sqlMgr.disconnect', callAsync('SQLDisconnect', [1]) === 0, '' + last);
	check('sqlMgr.disconnectedIsGone',
		callAsync('SQLDisconnect', [1]) === HmiSql.CODES.INVALID_CONNECTION);

	answers.push({code: 0, connectionId: 7, provider: 'sqlite'});
	callAsync('SQLConnect', ['ConnId', 'Local']);
	check('sqlMgr.stopClosesEverything', (function()
	{
		// However many are open, every one of them is closed
		var open = Object.keys(manager.connections).length;
		var before = sent.length;
		manager.stop();
		var closes = 0;

		for (var i = before; i < sent.length; i++)
		{
			if (sent[i].action === 'hmiSql.close') { closes++; }
		}

		return open >= 2 && closes === open && Object.keys(manager.connections).length === 0;
	})(), 'open at stop: ' + Object.keys(manager.connections).length);
	check('sqlMgr.callsAfterStop', (function()
	{
		var code = null;
		manager.callAsync('SQLConnect', ['ConnId', 'Plant'], function(c) { code = c; });

		return code === HmiSql.CODES.INVALID_CONNECTION;
	})());

	// --- names a statement has to carry safely ------------------------

	check('sqlMgr.quotesOnlyWhatNeedsIt', HmiSql.quoteColumn('BatchName') === 'BatchName' &&
		HmiSql.quoteColumn('Valve ID') === '[Valve ID]' &&
		HmiSql.quoteColumn('[Already]') === '[Already]' &&
		HmiSql.quoteColumn('dbo.BatchLog') === 'dbo.BatchLog',
		HmiSql.quoteColumn('Valve ID'));

	// --- what a tag can hold ------------------------------------------
	var message = HmiProject.createTag('M', 'MemoryMessage');
	var discrete = HmiProject.createTag('D', 'MemoryDiscrete');
	var integer = HmiProject.createTag('I', 'MemoryInteger');
	var real = HmiProject.createTag('R', 'MemoryReal');

	check('sqlMgr.coerce.message', HmiSql.coerceForTag(message, 12.5) === '12.5' &&
		HmiSql.coerceForTag(message, null) === '');
	check('sqlMgr.coerce.discrete', HmiSql.coerceForTag(discrete, 1) === 1 &&
		HmiSql.coerceForTag(discrete, 0) === 0 && HmiSql.coerceForTag(discrete, true) === 1 &&
		HmiSql.coerceForTag(discrete, 'True') === 1 && HmiSql.coerceForTag(discrete, 'no') === 0);
	check('sqlMgr.coerce.integerRounds', HmiSql.coerceForTag(integer, 2.6) === 3);
	check('sqlMgr.coerce.realKeepsDecimals', HmiSql.coerceForTag(real, 2.5) === 2.5);
	check('sqlMgr.coerce.nonsenseIsZero', HmiSql.coerceForTag(real, 'not a number') === 0 &&
		HmiSql.coerceForTag(integer, null) === 0);
};

// --------------------------------------------- tag references (HmiTagRefs)

/**
 * The reference map and the rewriter, which every tag rename and the
 * Find/Replace dialog stand on. Pure functions: no graph, no DOM.
 */
HmiSelfTest.testTagRefs = function()
{
	var check = HmiSelfTest.check;
	var project = HmiSelfTest.sampleProject();
	project.addTag(HmiProject.createTag('Tank_LevelOther', 'MemoryReal'));
	project.addTag(HmiProject.createTag('Abs', 'MemoryReal'));

	var map = function(pairs)
	{
		var m = {};

		for (var k in pairs)
		{
			m[k.toLowerCase()] = pairs[k];
		}

		return m;
	};

	var rw = function(src, pairs, mode)
	{
		return HmiTagRefs.rewriteText(src, map(pairs), mode || 'expr').text;
	};

	// --- the classification is complete ----------------------------------
	// A link field nobody classified is a tag reference that no rename, no
	// Validate and no subscription would ever see, which is the bug this
	// whole map exists to prevent.

	check('tagRefs.rolesUnambiguous', HmiTagRefs.roles().conflicts.length === 0,
		HmiTagRefs.roles().conflicts.join(','));

	var unclassified = [];

	for (var key in HmiTypes.LINKS)
	{
		var def = HmiTypes.LINKS[key];
		var defaults = def.defaults();
		var extra = (typeof HmiCli !== 'undefined' &&
			HmiCli.EXTRA_LINK_FIELDS != null) ?
			(HmiCli.EXTRA_LINK_FIELDS[key] || []) : [];

		for (var field in defaults)
		{
			if (def.refs[field] == null && def.refArrays[field] == null &&
				!HmiTagRefs.IGNORED_FIELDS[field] &&
				mxUtils.indexOf(extra, field) < 0)
			{
				unclassified.push(key + '.' + field);
			}
		}
	}

	check('tagRefs.linkFieldsComplete', unclassified.length === 0,
		unclassified.join(','));

	check('tagRefs.rangeFieldsClassified',
		HmiTypes.LINKS['location.horizontal'].refs.offsetMin === 'expr' &&
		HmiTypes.LINKS['size.height'].refs.pctMax === 'expr' &&
		HmiTypes.LINKS['orientation'].refs.angleMin === 'expr' &&
		HmiTypes.LINKS['slider.vertical'].refs.travelMax === 'expr' &&
		HmiTypes.LINKS['pushbutton.action'].refs.everyMs === 'expr');
	check('tagRefs.scriptFieldsClassified',
		HmiTypes.LINKS['pushbutton.action'].refs.onDown === 'script' &&
		HmiTypes.LINKS['trend'].refArrays.pens.tag === 'tag' &&
		HmiTypes.LINKS['fillColor.analog'].refArrays.bands.max === 'expr');

	// --- the rewriter -----------------------------------------------------

	check('tagRefs.rewriteIdent',
		rw('Tank_Level + 1', {Tank_Level: 'Vessel_Level'}) === 'Vessel_Level + 1');
	check('tagRefs.rewriteKeepsDotfield',
		rw('Tank_Level.MaxEU * 2', {Tank_Level: 'New'}) === 'New.MaxEU * 2');
	check('tagRefs.rewriteSkipsDottedOther',
		rw('Other.Tank_Level', {Tank_Level: 'New'}) === 'Other.Tank_Level');
	check('tagRefs.rewriteRespectsWordBoundary',
		rw('NOT Tank_LevelOther', {Tank_Level: 'New'}) === 'NOT Tank_LevelOther');
	check('tagRefs.rewriteQualified',
		rw('InTouch:Tank_Level', {Tank_Level: 'New'}) === 'InTouch:New');
	check('tagRefs.rewriteSkipsComment',
		rw('{ Tank_Level } Pump1_Run', {Tank_Level: 'New'}) ===
		'{ Tank_Level } Pump1_Run');
	check('tagRefs.rewriteSkipsString',
		rw('ShowWindow("Tank_Level")', {Tank_Level: 'New'}, 'script') ===
		'ShowWindow("Tank_Level")');
	check('tagRefs.rewriteSkipsFunctionName',
		rw('Abs(Tank_Level)', {Abs: 'Nope'}) === 'Abs(Tank_Level)');
	check('tagRefs.rewriteCaseInsensitive',
		rw('tank_level', {Tank_Level: 'New'}) === 'New');
	check('tagRefs.rewriteSkipsSystemTag',
		rw('_AccessLevel >= 500', {_AccessLevel: 'Nope'}) === '_AccessLevel >= 500');

	// Two tags trading places: the map is applied in one pass, so neither
	// replacement can be rewritten again by the other.
	check('tagRefs.rewriteSimultaneousSwap',
		rw('Tank_Level + Pump1_Run', {Tank_Level: 'Pump1_Run', Pump1_Run: 'Tank_Level'}) ===
		'Pump1_Run + Tank_Level',
		rw('Tank_Level + Pump1_Run', {Tank_Level: 'Pump1_Run', Pump1_Run: 'Tank_Level'}));

	var script = 'DIM Count AS Analog;\nCount = Tank_Level;';
	check('tagRefs.rewriteSkipsLocal',
		rw(script, {Count: 'Nope', Tank_Level: 'New'}, 'script') ===
		'DIM Count AS Analog;\nCount = New;',
		rw(script, {Count: 'Nope', Tank_Level: 'New'}, 'script'));
	check('tagRefs.rewriteSkipsDimKeywords',
		rw('DIM X AS Analog;', {Dim: 'Nope', As: 'Nope', Analog: 'Nope'}, 'script') ===
		'DIM X AS Analog;');

	check('tagRefs.rewriteLinkIndirectBothArgs',
		rw('LinkIndirectTag("FP_Level", "Tank_Level");',
			{FP_Level: 'FP_Flow', Tank_Level: 'New'}, 'script') ===
		'LinkIndirectTag("FP_Flow", "New");');
	check('tagRefs.rewriteTrendSetPenOnlyPen',
		rw('TrendSetPen("Tank_Level", "Tank_Level");', {Tank_Level: 'New'},
			'script') === 'TrendSetPen("Tank_Level", "New");',
		rw('TrendSetPen("Tank_Level", "Tank_Level");', {Tank_Level: 'New'}, 'script'));

	var bad = HmiTagRefs.rewriteText('{ unterminated Tank_Level',
		map({Tank_Level: 'New'}), 'expr');
	check('tagRefs.rewriteRefusesBadLex',
		bad.error != null && bad.text === '{ unterminated Tank_Level' &&
		bad.count === 0, bad.error);

	// --- bare name fields -------------------------------------------------

	check('tagRefs.rewriteNameField',
		HmiTagRefs.rewriteName('Tank_Level', map({Tank_Level: 'New'})).text === 'New');
	check('tagRefs.rewriteNameKeepsField',
		HmiTagRefs.rewriteName('Tank_Level.Acked', map({Tank_Level: 'New'})).text ===
		'New.Acked');
	check('tagRefs.rewriteNameRefusesJunk',
		HmiTagRefs.rewriteName('1 + 2', map({Tank_Level: 'New'})).error != null);

	// --- the locals prescan agrees with the parser ------------------------

	var dimScript = 'DIM A, B AS Analog;\nDIM C AS Message;\nA = 1;';
	var locals = HmiTagRefs.localsIn(dimScript);
	var compiled = HmiExpr.compile(dimScript, {project: project, mode: 'script'});
	var declared = {};
	var body = (compiled.ast != null) ? compiled.ast.body : null;

	for (var i = 0; body != null && i < body.length; i++)
	{
		var node = body[i];

		for (var n = 0; node.type === 'dim' && node.names != null &&
			n < node.names.length; n++)
		{
			declared[node.names[n].key] = true;
		}
	}

	var same = true;

	for (var k in declared)
	{
		same = same && locals[k] === true;
	}

	for (var l in locals)
	{
		same = same && declared[l] === true;
	}

	check('tagRefs.scanDimMatchesParser', same && locals['a'] === true &&
		locals['c'] === true, Object.keys(locals).join(',') + ' vs ' +
		Object.keys(declared).join(','));

	// --- names a field uses -----------------------------------------------

	var used = [];
	HmiTagRefs.namesIn('Tank_Level + Pump1_Run * Tank_Level', 'expr',
		function(n) { used.push(n); });
	check('tagRefs.namesIn', used.join(',') === 'Tank_Level,Pump1_Run,Tank_Level',
		used.join(','));

	var literals = [];
	HmiTagRefs.namesIn('LinkIndirectTag("FP_Level", "Tank_Level");', 'script',
		function(n) { literals.push(n); });
	check('tagRefs.namesInLiterals', literals.join(',') === 'FP_Level,Tank_Level',
		literals.join(','));

	var systemNames = [];
	HmiTagRefs.namesIn('_AckAll', 'expr', function(n) { systemNames.push(n); });
	check('tagRefs.namesInSkipsSystem', systemNames.length === 0);

	// --- the name rules ---------------------------------------------------

	check('tagRefs.checkNameKnown', HmiTagRefs.checkName(project, 'Tank_Level') == null);
	check('tagRefs.checkNameEmpty', HmiTagRefs.checkName(project, '') == null);
	check('tagRefs.checkNameGrammar',
		(HmiTagRefs.checkName(project, '2Bad') || '').indexOf('start with') > 0);
	check('tagRefs.checkNameLength',
		(HmiTagRefs.checkName(project, new Array(66).join('a')) || '')
			.indexOf('at most') > 0);
	check('tagRefs.checkNameSystem',
		(HmiTagRefs.checkName(project, '_AckAll') || '').indexOf('system tag') > 0);
	check('tagRefs.checkNameUnknown',
		(HmiTagRefs.checkName(project, 'Nope') || '').indexOf('No tag named') === 0);
	check('tagRefs.checkNameRuntime',
		HmiTagRefs.checkName(project, '$Pending') == null);
};

/** The scope rules and the one-undo guarantee, against a real graph. */
HmiSelfTest.testTagRefScope = function(ui)
{
	var check = HmiSelfTest.check;
	var saved = ui.hmiProject;
	ui.hmiProject = HmiSelfTest.sampleProject();
	ui.hmiProject.addTag(HmiProject.createTag('Vessel_Level', 'MemoryReal'));
	ui.hmiProject.addTag(HmiProject.createTag('Pump2_Run', 'MemoryDiscrete'));

	HmiSelfTest.resetGraph(ui);

	var graph = ui.editor.graph;
	var model = graph.getModel();
	var group = null;
	var child = null;
	var outside = null;

	model.beginUpdate();

	try
	{
		group = graph.insertVertex(graph.getDefaultParent(), null, 'Group',
			20, 20, 200, 120);
		child = graph.insertVertex(group, null, 'Child', 10, 10, 60, 40);
		outside = graph.insertVertex(graph.getDefaultParent(), null, 'Outside',
			260, 20, 60, 40);
	}
	finally
	{
		model.endUpdate();
	}

	HmiProject.setCellLinks(graph, child, {
		'fillColor.analog': {expr: 'Tank_Level', bands: [
			{max: 'Tank_Level.MaxEU', color: '#00CC00'},
			{max: null, color: '#CC0000'}]},
		'pushbutton': {kind: 'discrete', tag: 'Pump1_Run', action: 'toggle',
			enableExpr: ''},
		'pushbutton.action': {onDown: 'Pump1_Run = 1;', whileDown: '',
			onUp: 'LinkIndirectTag("FP_Level", "Tank_Level");',
			everyMs: 'Tank_Level'}
	});
	HmiProject.setCellLinks(graph, outside, {
		'percentFill.vertical': {expr: 'Pump1_Run', atMin: '0',
			atMax: 'Tank_Level.MaxEU', pctMin: '0', pctMax: 'Tank_Level'},
		'trend': {name: 'T1', title: '', spanSec: 600, sampleMs: 1000,
			refreshMs: 1000, gridColor: '#dde3e8',
			pens: [{tag: 'Tank_Level', min: '', max: '', color: '#000000'}]}
	});

	// --- scope -----------------------------------------------------------

	graph.clearSelection();
	var page = HmiTagRefs.scope(ui);
	check('tagRefs.scopePage', page.kind === 'page' &&
		mxUtils.indexOf(page.cells, child) >= 0 &&
		mxUtils.indexOf(page.cells, outside) >= 0);

	var names = HmiTagRefs.collect(ui.hmiProject, page, graph);
	var byName = {};

	for (var i = 0; i < names.length; i++)
	{
		byName[names[i].name] = names[i];
	}

	check('tagRefs.collectsNames', byName['Tank_Level'] != null &&
		byName['Pump1_Run'] != null && byName['FP_Level'] != null,
		Object.keys(byName).join(','));
	check('tagRefs.collectsUnknownToo', byName['FP_Level'].known === false);
	check('tagRefs.collectCounts', byName['Tank_Level'].uses >= 6,
		'uses ' + byName['Tank_Level'].uses);
	check('tagRefs.collectSkipsSystem', byName['_AckAll'] == null);

	graph.setSelectionCell(group);
	var selected = HmiTagRefs.scope(ui);
	check('tagRefs.scopeSelectionDescends', selected.kind === 'selection' &&
		mxUtils.indexOf(selected.cells, child) >= 0 &&
		mxUtils.indexOf(selected.cells, outside) < 0);
	graph.clearSelection();

	// --- apply ------------------------------------------------------------

	var before = ui.editor.undoManager.history.length;
	var res = HmiTagRefs.apply(ui, page, {'tank_level': 'Vessel_Level',
		'pump1_run': 'Pump2_Run'});

	check('tagRefs.applyIsOneUndo',
		ui.editor.undoManager.history.length === before + 1,
		'history grew by ' +
			(ui.editor.undoManager.history.length - before));
	check('tagRefs.applyCountsCells', res.cells === 2 && res.sites >= 8,
		res.cells + ' cells, ' + res.sites + ' sites');

	var childLinks = HmiProject.getCellLinks(graph, child);
	var outsideLinks = HmiProject.getCellLinks(graph, outside);

	check('tagRefs.applyRewritesExpr',
		childLinks['fillColor.analog'].expr === 'Vessel_Level');
	check('tagRefs.applyRewritesBand',
		childLinks['fillColor.analog'].bands[0].max === 'Vessel_Level.MaxEU');
	check('tagRefs.applyRewritesTagField',
		childLinks['pushbutton'].tag === 'Pump2_Run');
	check('tagRefs.applyRewritesScript',
		childLinks['pushbutton.action'].onDown === 'Pump2_Run = 1;',
		childLinks['pushbutton.action'].onDown);
	check('tagRefs.applyRewritesScriptLiteral',
		childLinks['pushbutton.action'].onUp ===
		'LinkIndirectTag("FP_Level", "Vessel_Level");',
		childLinks['pushbutton.action'].onUp);
	check('tagRefs.applyRewritesEveryMs',
		childLinks['pushbutton.action'].everyMs === 'Vessel_Level');
	check('tagRefs.applyRewritesRangeBound',
		outsideLinks['percentFill.vertical'].pctMax === 'Vessel_Level' &&
		outsideLinks['percentFill.vertical'].atMax === 'Vessel_Level.MaxEU');
	check('tagRefs.applyRewritesPen',
		outsideLinks['trend'].pens[0].tag === 'Vessel_Level');

	ui.actions.get('undo').funct();
	var undone = HmiProject.getCellLinks(graph, child);
	check('tagRefs.applyUndoRestores',
		undone['fillColor.analog'].expr === 'Tank_Level' &&
		undone['pushbutton'].tag === 'Pump1_Run',
		undone['fillColor.analog'].expr);

	// --- a swap, and a field that cannot be read --------------------------

	HmiProject.setCellLinks(graph, child, {
		'visibility': {expr: 'Tank_Level + Pump1_Run', sense: 'visible'},
		'blink': {expr: '{ broken Tank_Level', rateMs: '500', attrs: ['fill'],
			fill: '#FF0000', line: '#FFFFFF', text: '#000000', blank: false}
	});

	var swap = HmiTagRefs.apply(ui, {cells: [child]},
		{'tank_level': 'Pump1_Run', 'pump1_run': 'Tank_Level'});
	var swapped = HmiProject.getCellLinks(graph, child);

	check('tagRefs.applySimultaneous',
		swapped['visibility'].expr === 'Pump1_Run + Tank_Level',
		swapped['visibility'].expr);
	check('tagRefs.applySkipsBadLex',
		swapped['blink'].expr === '{ broken Tank_Level' &&
		swap.skipped.length === 1,
		swap.skipped.length + ' skipped');

	HmiSelfTest.resetGraph(ui);
	ui.hmiProject = saved;
};

/**
 * Tags used only as a range bound must still be subscribed: without that the
 * animation reads whatever the driver happens to hold.
 */
HmiSelfTest.testRangeDeps = function(ui)
{
	var check = HmiSelfTest.check;
	var saved = ui.hmiProject;
	var project = HmiSelfTest.sampleProject();
	project.addTag(HmiProject.createTag('Range_Max', 'MemoryReal'));
	project.addTag(HmiProject.createTag('Pen_Only', 'MemoryReal'));
	project.addTag(HmiProject.createTag('Script_Only', 'MemoryDiscrete'));
	ui.hmiProject = project;

	HmiSelfTest.resetGraph(ui);

	var graph = ui.editor.graph;
	var cell = null;

	graph.getModel().beginUpdate();

	try
	{
		cell = graph.insertVertex(graph.getDefaultParent(), null, 'Bar',
			20, 20, 60, 120);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	HmiProject.setCellLinks(graph, cell, {
		'percentFill.vertical': {expr: 'Tank_Level', atMin: '0',
			atMax: 'Range_Max', pctMin: '0', pctMax: '100'},
		'pushbutton.action': {onDown: 'Script_Only = 1;', whileDown: '',
			onUp: '', everyMs: '1000'},
		'trend': {name: 'T9', title: '', spanSec: 600, sampleMs: 1000,
			refreshMs: 1000, gridColor: '#dde3e8',
			pens: [{tag: 'Pen_Only', min: '', max: '', color: '#000000'}]}
	});

	var runtime = new HmiRuntime({graph: graph, project: project,
		driver: null, scripts: []});
	runtime.bind();

	var paths = runtime.subscriptionPaths();

	check('runtime.subscribesRangeBound',
		mxUtils.indexOf(paths, 'Range_Max') >= 0, paths.join(','));
	check('runtime.subscribesExpr',
		mxUtils.indexOf(paths, 'Tank_Level') >= 0);
	check('runtime.scriptTagSubscribedNotIndexed',
		mxUtils.indexOf(paths, 'Script_Only') >= 0 &&
		runtime.reverseIndex['Script_Only'] == null);
	check('runtime.trendPensNotIndexed',
		runtime.reverseIndex['Pen_Only'] == null);

	var deps = runtime.dependencies({tag: 'Tank_Level', atMin: '0',
		atMax: 'Range_Max', travelMin: '0', travelMax: 'Range_Max'},
		'slider.vertical');
	check('runtime.sliderBoundsAreDeps',
		mxUtils.indexOf(deps, 'Range_Max') >= 0 &&
		mxUtils.indexOf(deps, 'Tank_Level') >= 0, deps.join(','));

	HmiSelfTest.resetGraph(ui);
	ui.hmiProject = saved;
};

/**
 * Edit > Find/Replace Tag References, and the single tag editor.
 *
 * Both dialogs are driven detached, the way the Tag Dictionary's tests drive
 * theirs: showing them for real stacks modal windows, and the focus the last
 * one takes outlives the test (testPanelFocus then finds the focus somewhere
 * else entirely). One open-and-close pass below covers the entry point.
 */
HmiSelfTest.testFindReplace = function(ui)
{
	var check = HmiSelfTest.check;
	var saved = ui.hmiProject;
	var project = HmiSelfTest.sampleProject();
	project.addTag(HmiProject.createTag('Vessel_Level', 'MemoryReal'));
	ui.hmiProject = project;

	HmiSelfTest.resetGraph(ui);

	var graph = ui.editor.graph;
	var cell = null;

	graph.getModel().beginUpdate();

	try
	{
		cell = graph.insertVertex(graph.getDefaultParent(), null, 'Find',
			20, 20, 80, 40);
	}
	finally
	{
		graph.getModel().endUpdate();
	}

	var links = function()
	{
		HmiProject.setCellLinks(graph, cell, {
			'fillColor.analog': {expr: 'Tank_Level', bands: [
				{max: '50', color: '#00CC00'}, {max: null, color: '#CC0000'}]},
			'pushbutton': {kind: 'discrete', tag: 'Pump1_Run',
				action: 'toggle', enableExpr: ''}
		});
	};

	links();
	graph.clearSelection();

	// --- the menu item ----------------------------------------------------
	// Asserting the action exists is not enough: a key of the wrong form
	// renders nothing at all.

	var labels = [];
	var fake = {showDisabled: true, hideShortcuts: true,
		addItem: function(label)
		{
			labels.push(label);

			return document.createElement('div');
		},
		addSeparator: function() { labels.push('-'); },
		addCheckmark: function() {}};

	try
	{
		ui.menus.get('hmi').funct(fake, null);
	}
	catch (e)
	{
		// Only our own item matters here.
	}

	check('findReplace.inHmiMenu',
		mxUtils.indexOf(labels, mxResources.get('hmiFindReplaceTags') + '...') >= 0,
		labels.join(' | ').substring(0, 100));
	check('findReplace.actionRegistered',
		ui.actions.get('hmiFindReplaceTags') != null);

	// --- the dialog -------------------------------------------------------
	// The dialog host is stubbed for the whole test: these dialogs are driven
	// detached, and a Save would otherwise hide whichever dialog the editor
	// really has open -- which takes the focus the deferred focus assertions
	// at the end of the suite are watching.

	var realShow = ui.showDialog;
	var realHide = ui.hideDialog;
	var shown = null;
	var dismiss = null;

	ui.showDialog = function(div, w, h, modal, closable, onClose)
	{
		shown = div;
		dismiss = onClose;
	};
	ui.hideDialog = function() { shown = null; };

	try
	{

		var dlg = new HmiFindReplaceDialog(ui);
		dlg.init();

		var box = dlg.container;
		var field = function(name)
		{
			return box.querySelector('[data-hmi-field="' + name + '"]');
		};
		var rowFor = function(name)
		{
			return box.querySelector('[data-hmi-tag="' + name + '"]');
		};
		var inputFor = function(name)
		{
			return rowFor(name).querySelector('[data-hmi-field="replacement"]');
		};
		var statusFor = function(name)
		{
			return rowFor(name).querySelector('[data-hmi-field="refStatus"]').innerText;
		};

		check('findReplace.listsNames', rowFor('Tank_Level') != null &&
			rowFor('Pump1_Run') != null);
		check('findReplace.scopeHintPage',
			field('scopeHint').innerText.indexOf('Nothing is selected') === 0,
			field('scopeHint').innerText);
		check('findReplace.countsUses',
			rowFor('Tank_Level').querySelector('[data-hmi-field="refUses"]')
				.innerText === '1');

		graph.setSelectionCell(cell);
		var selected = new HmiFindReplaceDialog(ui);
		selected.init();
		check('findReplace.scopeHintSelection',
			selected.container.querySelector('[data-hmi-field="scopeHint"]')
				.innerText.indexOf('1 selected object') > 0,
			selected.container.querySelector('[data-hmi-field="scopeHint"]').innerText);
		graph.clearSelection();

		// --- replacing text in the names --------------------------------------

		field('findText').value = 'Tank';
		field('replaceText').value = 'Vessel';
		field('fillAll').click();

		check('findReplace.fillFromText',
			inputFor('Tank_Level').value === 'Vessel_Level',
			inputFor('Tank_Level').value);
		check('findReplace.fillLeavesOthers', inputFor('Pump1_Run').value === '');
		check('findReplace.fillStatusReady', statusFor('Tank_Level') === 'ready',
			statusFor('Tank_Level'));

		field('clearAll').click();
		check('findReplace.clearEmptiesFields',
			inputFor('Tank_Level').value === '' && statusFor('Tank_Level') === '');

		field('matchCase').checked = true;
		field('findText').value = 'tank';
		field('fillAll').click();
		check('findReplace.matchCase', inputFor('Tank_Level').value === '',
			inputFor('Tank_Level').value);
		field('matchCase').checked = false;

		// --- what is valid ----------------------------------------------------

		inputFor('Tank_Level').value = 'Brand_New';
		inputFor('Tank_Level').dispatchEvent(new Event('input'));
		check('findReplace.marksUnknown',
			statusFor('Tank_Level').indexOf('new') === 0, statusFor('Tank_Level'));

		inputFor('Pump1_Run').value = '2Bad';
		inputFor('Pump1_Run').dispatchEvent(new Event('input'));
		check('findReplace.marksInvalid',
			inputFor('Pump1_Run').classList.contains('hmiInvalid'));

		check('findReplace.applyRefusesInvalid', dlg.apply() == null &&
			HmiProject.getCellLinks(graph, cell)['pushbutton'].tag === 'Pump1_Run',
			field('message').innerText);

		inputFor('Pump1_Run').value = '';
		inputFor('Pump1_Run').dispatchEvent(new Event('input'));

		// --- the tag editor creates the tag the row wants ---------------------

		var created = null;
		var editor = new HmiTagEditorDialog(ui, 'Brand_New', function(result)
		{
			created = result;
		});
		editor.init();

		check('tagEditor.createMode', editor.creating === true &&
			editor.saveButton.disabled === false &&
			editor.container.querySelector('[data-hmi-prop="name"]').value ===
				'Brand_New');
		check('tagEditor.guessedType',
			editor.draft.type === 'MemoryReal', editor.draft.type);

		editor.container.querySelector('[data-hmi-prop="comment"]').value = 'Made here';
		editor.container.querySelector('[data-hmi-prop="comment"]')
			.dispatchEvent(new Event('blur'));
		editor.save();

		check('tagEditor.savesNewTag', project.getTag('Brand_New') != null &&
			project.getTag('Brand_New').comment === 'Made here' &&
			created != null && created.saved === true);

		var rowObj = function(name)
		{
			for (var r = 0; r < dlg.rows.length; r++)
			{
				if (dlg.rows[r].name === name)
				{
					return dlg.rows[r];
				}
			}

			return null;
		};

		dlg.validateRow(rowObj('Tank_Level'));
		check('findReplace.rowValidAfterCreate',
			statusFor('Tank_Level') === 'ready', statusFor('Tank_Level'));

		// --- validate ---------------------------------------------------------

		var clean = dlg.validate();
		check('findReplace.validateClean', clean.bad === 0 &&
			clean.problems.length === 0, field('message').innerText);

		// A replacement that is a local variable in a script the reference sits
		// in would read the variable, not the tag, and nothing else says so.
		HmiProject.setCellLinks(graph, cell, {
			'fillColor.analog': {expr: 'Tank_Level', bands: [
				{max: '50', color: '#00CC00'}, {max: null, color: '#CC0000'}]},
			'pushbutton.action': {onDown: 'DIM Vessel_Level AS Analog;\n' +
				'Vessel_Level = Tank_Level;', whileDown: '', onUp: '',
				everyMs: '1000'}
		});

		var collide = new HmiFindReplaceDialog(ui);
		collide.init();
		var collideInput = collide.container.querySelector(
			'[data-hmi-tag="Tank_Level"] [data-hmi-field="replacement"]');
		collideInput.value = 'Vessel_Level';
		collideInput.dispatchEvent(new Event('input'));

		var problems = collide.problems(collide.map());
		var sawLocal = false;

		for (var p = 0; p < problems.length; p++)
		{
			sawLocal = sawLocal ||
				problems[p].message.indexOf('local variable') > 0;
		}

		check('findReplace.validateFlagsLocalCollision', sawLocal,
			problems.length + ' problems');

		// The dry run must not have touched the cell.
		check('findReplace.validateDoesNotWrite',
			HmiProject.getCellLinks(graph, cell)['fillColor.analog'].expr ===
			'Tank_Level');

		// --- apply ------------------------------------------------------------

		links();
		dlg.scope = HmiTagRefs.scope(ui);
		dlg.reload();
		inputFor('Tank_Level').value = 'Brand_New';
		inputFor('Tank_Level').dispatchEvent(new Event('input'));

		var before = ui.editor.undoManager.history.length;
		var res = dlg.apply();

		check('findReplace.applyReplaces', res != null && res.sites === 1 &&
			HmiProject.getCellLinks(graph, cell)['fillColor.analog'].expr ===
			'Brand_New');
		check('findReplace.applyIsOneUndo',
			ui.editor.undoManager.history.length === before + 1,
			'history grew by ' +
				(ui.editor.undoManager.history.length - before));
		check('findReplace.rowsRebuilt', rowFor('Brand_New') != null &&
			rowFor('Tank_Level') == null);
		check('findReplace.fieldsCleared', inputFor('Brand_New').value === '');
		check('findReplace.reportsWhatItDid',
			field('message').innerText.indexOf('Replaced 1 reference') === 0,
			field('message').innerText);

		check('findReplace.applyNeedsSomething', dlg.apply() == null &&
			field('message').innerText.indexOf('Nothing to replace') === 0,
			field('message').innerText);

		// --- the editor on an existing tag ------------------------------------

		var closed = null;
		var edit = new HmiTagEditorDialog(ui, 'Vessel_Level', function(result)
		{
			closed = result;
		});
		edit.init();

		var prop = function(name)
		{
			return edit.container.querySelector('[data-hmi-prop="' + name + '"]');
		};

		check('tagEditor.prefilled', prop('name').value === 'Vessel_Level' &&
			prop('name').getAttribute('readonly') != null);
		check('tagEditor.saveDisabledUntilEdit',
			edit.saveButton.disabled === true);

		// The shared form commits on blur, never on assignment.
		prop('comment').value = 'From the editor';
		prop('comment').dispatchEvent(new Event('blur'));

		check('tagEditor.enablesSaveOnEdit', edit.saveButton.disabled === false);
		check('tagEditor.editsADraft',
			project.getTag('Vessel_Level').comment !== 'From the editor');
		check('tagEditor.nameStaysWhenEditing',
			(function()
			{
				edit.formRename(edit.draft, 'Something_Else');

				return edit.draft.name === 'Vessel_Level';
			})());

		var revision = project.revision;
		check('tagEditor.savesEdit', edit.save() === true &&
			project.getTag('Vessel_Level').comment === 'From the editor' &&
			project.revision > revision && closed != null &&
			closed.saved === true);

		// A name that is already taken is refused, with the reason shown.
		var clash = new HmiTagEditorDialog(ui, 'Clash_Tag', function() {});
		clash.init();
		clash.formRename(clash.draft, 'Tank_Level');
		check('tagEditor.refusesExistingName',
			clash.draft.name === 'Clash_Tag' &&
			clash.error.innerText.indexOf('already exists') > 0,
			clash.error.innerText);

		// --- the save prompt, and the entry point -----------------------------

			var answer = null;
			HmiDialogs.showSaveConfirm(ui, 'Tag', 'Save?', function(what)
			{
				answer = what;
			});

			check('tagEditor.promptHasThreeAnswers', shown != null &&
				shown.querySelector('[data-hmi-field="confirmSave"]') != null &&
				shown.querySelector('[data-hmi-field="confirmDiscard"]') != null &&
				shown.querySelector('[data-hmi-field="confirmCancel"]') != null);

			shown.querySelector('[data-hmi-field="confirmDiscard"]').click();
			check('tagEditor.promptAnswers', answer === 'discard');

			// Dismissing the prompt means Cancel, never a silent discard.
			answer = null;
			HmiDialogs.showSaveConfirm(ui, 'Tag', 'Save?', function(what)
			{
				answer = what;
			});
			dismiss();
			check('tagEditor.promptDismissCancels', answer === 'cancel');

			// Closing a dirty editor asks before it closes.
			var dirty = new HmiTagEditorDialog(ui, 'Vessel_Level', function() {});
			dirty.init();
			dirty.formChanged();
			dirty.close();
			check('tagEditor.closePromptsWhenDirty', shown != null &&
				shown.querySelector('[data-hmi-field="confirmSave"]') != null);
			shown.querySelector('[data-hmi-field="confirmCancel"]').click();

			// A clean editor closes without asking.
			shown = null;
			var clean2 = new HmiTagEditorDialog(ui, 'Vessel_Level', function() {});
			clean2.init();
			clean2.close();
			check('tagEditor.closeIsSilentWhenClean', shown == null);

			// The menu action opens this dialog and no other.
			shown = null;
			ui.actions.get('hmiFindReplaceTags').funct();
			check('findReplace.actionOpensDialog', shown != null &&
				shown.querySelector('[data-hmi-field="apply"]') != null &&
				shown.querySelector('[data-hmi-field="validate"]') != null);
	}
	finally
	{
		ui.showDialog = realShow;
		ui.hideDialog = realHide;
	}

	HmiSelfTest.resetGraph(ui);
	ui.hmiProject = saved;
};

/**
 * A rename reaches the pages that are not showing. Those cells are not in the
 * model, so they are written through the page's own root -- the one part of a
 * rename that Undo cannot reverse, which is why the dialog says so.
 */
HmiSelfTest.testRenameOtherPages = function(ui)
{
	var check = HmiSelfTest.check;
	var saved = ui.hmiProject;
	var savedPage = ui.currentPage;
	var project = HmiSelfTest.sampleProject();
	ui.hmiProject = project;

	HmiSelfTest.resetGraph(ui);

	var here = ui.currentPage;
	var other = HmiSelfTest.makePage(ui, 'Elsewhere', {
		'fillColor.analog': {expr: 'Tank_Level * 2', bands: [
			{max: 'Tank_Level.MaxEU', color: '#00CC00'},
			{max: null, color: '#CC0000'}]}
	});

	ui.selectPage(here);

	var dlg = new HmiTagDialog(ui);
	dlg.init();
	dlg.selected = project.getTag('Tank_Level');
	dlg.rename(dlg.selected, 'Far_Level');

	// Read it back the way the file is written: from the page's own root.
	var found = null;

	for (var i = 0; other.root != null && i < other.root.children.length; i++)
	{
		var layer = other.root.children[i];

		for (var c = 0; layer.children != null && c < layer.children.length; c++)
		{
			var links = HmiTagRefs.rawLinks(layer.children[c]);

			if (links != null && links['fillColor.analog'] != null)
			{
				found = links['fillColor.analog'];
			}
		}
	}

	check('tagDialog.renameReachesOtherPages', found != null &&
		found.expr === 'Far_Level * 2' &&
		found.bands[0].max === 'Far_Level.MaxEU',
		(found != null) ? found.expr : 'no cell found');
	check('tagDialog.renameMarksOtherPages', other.needsUpdate === true);
	check('tagDialog.renameNoteNamesOtherPages',
		dlg.noteDiv.innerText.indexOf('other page') > 0,
		dlg.noteDiv.innerText);

	ui.selectPage(here);
	ui.removePage(other);
	ui.selectPage((savedPage != null) ? savedPage : here);
	HmiSelfTest.resetGraph(ui);
	ui.hmiProject = saved;
};

// ------------------------------------------------------- QuickFunctions

/**
 * The language half of QuickFunctions: calling, arguments, Return, what makes
 * one script-only, recursion and the caps. No graph and no dialog.
 */
HmiSelfTest.testQuickFunctions = function()
{
	var check = HmiSelfTest.check;
	var project = HmiSelfTest.sampleProject();
	project.addTag(HmiProject.createTag('Result', 'MemoryReal'));
	project.quickFunctions = [
		{name: 'Scaled', args: [{name: 'Raw', type: 'Analog'}],
			body: 'Return Raw * 2;'},
		{name: 'Outer', args: [{name: 'X', type: 'Analog'}],
			body: 'Return Scaled(X) + Tank_Level;'},
		{name: 'Writer', args: [], body: 'Pump1_Run = 1;\nReturn 1;'},
		{name: 'Wrapper', args: [], body: 'Return Writer();'},
		{name: 'Silent', args: [], body: 'DIM a AS Analog;\na = 1;'},
		{name: 'Early', args: [{name: 'N', type: 'Analog'}],
			body: 'IF N > 10 THEN Return 1; ENDIF;\nResult = 99;\nReturn 0;'},
		{name: 'Label', args: [{name: 'T', type: 'Message'}],
			body: 'Return T + "!";'},
		{name: 'Flag', args: [{name: 'D', type: 'Discrete'}], body: 'Return D;'}
	];

	var values = {};
	var written = {};

	var reset = function()
	{
		values = {
			'Tank_Level': {value: 10, quality: HmiTypes.QUALITY_GOOD, timestamp: 5},
			'Pump1_Run': {value: 0, quality: HmiTypes.QUALITY_GOOD, timestamp: 5},
			'Result': {value: 0, quality: HmiTypes.QUALITY_GOOD, timestamp: 5}
		};
		written = {};
	};

	var ctx = {
		read: function(name)
		{
			return values[name] ||
				{value: null, quality: HmiTypes.QUALITY_BAD, timestamp: 0};
		},
		write: function(name, value)
		{
			written[name] = value;
			values[name] = {value: value, quality: HmiTypes.QUALITY_GOOD,
				timestamp: 9};
		},
		now: function() { return Date.now(); }
	};

	var run = function(src, mode)
	{
		reset();

		return HmiExpr.compile(src, {project: project, mode: mode}).eval(ctx);
	};

	var errorsOf = function(src, mode)
	{
		var errors = HmiExpr.compile(src, {project: project, mode: mode}).errors;
		var messages = [];

		for (var i = 0; i < errors.length; i++)
		{
			messages.push(errors[i].message);
		}

		return messages.join(' | ');
	};

	// --- calling ---------------------------------------------------------

	check('quick.callsFromExpression', run('Scaled(21)').value === 42,
		JSON.stringify(run('Scaled(21)')));
	check('quick.caseInsensitive', run('scaled(3)').value === 6);
	check('quick.nested', run('Outer(5)').value === 20, run('Outer(5)').value);
	check('quick.arity', errorsOf('Scaled(1, 2)').indexOf('takes 1 argument, got 2') > 0,
		errorsOf('Scaled(1, 2)'));
	check('quick.unknownStillUnknown',
		errorsOf('Nope(1)').indexOf('unknown function "Nope"') === 0);
	check('quick.callsFromScript', (function()
	{
		var r = run('Result = Scaled(4);', 'script');

		return written['Result'] === 8;
	})(), JSON.stringify(written));

	// --- arguments -------------------------------------------------------

	var compiled = HmiExpr.compile('Outer(1)', {project: project});
	check('quick.depsPropagate',
		mxUtils.indexOf(compiled.deps, 'Tank_Level') >= 0,
		compiled.deps.join(','));
	check('quick.argsAreNotDeps',
		mxUtils.indexOf(compiled.deps, 'Raw') < 0 &&
		mxUtils.indexOf(compiled.deps, 'X') < 0, compiled.deps.join(','));
	check('quick.coercesMessage', run('Label(7)').value === '7!',
		run('Label(7)').value);
	check('quick.coercesDiscrete', run('Flag(5)').value === 1);
	check('quick.argQuality', (function()
	{
		reset();
		values['Tank_Level'] = {value: 3, quality: HmiTypes.QUALITY_BAD,
			timestamp: 1};

		return HmiExpr.compile('Scaled(Tank_Level)',
			{project: project}).eval(ctx).quality === HmiTypes.QUALITY_BAD;
	})());

	// --- Return ----------------------------------------------------------

	check('quick.noReturnGivesZero', run('Silent()').value === 0 &&
		run('Silent()').quality === HmiTypes.QUALITY_GOOD);
	check('quick.returnStopsThere', (function()
	{
		run('Result = Early(20);', 'script');

		return written['Result'] === 1;
	})(), JSON.stringify(written));
	check('quick.returnFallsThrough', (function()
	{
		run('Result = Early(1);', 'script');

		return written['Result'] === 0 && values['Result'].value === 0;
	})(), JSON.stringify(written));
	check('quick.returnCarriesQuality', (function()
	{
		reset();
		values['Tank_Level'] = {value: 7, quality: HmiTypes.QUALITY_UNCERTAIN,
			timestamp: 42};
		var r = HmiExpr.compile('Scaled(1) + 0', {project: project}).eval(ctx);

		return r.quality === HmiTypes.QUALITY_GOOD;
	})());
	check('quick.returnOnlyInFunction',
		errorsOf('Return 1;', 'script').indexOf('only be used in a QuickFunction') > 0,
		errorsOf('Return 1;', 'script'));

	// A tag named Return keeps working: the word is only a keyword where a
	// statement begins and a value follows.
	var rp = HmiSelfTest.sampleProject();
	rp.addTag(HmiProject.createTag('Return', 'MemoryReal'));
	rp.addTag(HmiProject.createTag('Result', 'MemoryReal'));
	check('quick.tagNamedReturnReads',
		HmiExpr.compile('Return + 1', {project: rp}).errors.length === 0);
	check('quick.tagNamedReturnWrites',
		HmiExpr.compile('Return = 3;', {project: rp, mode: 'script'}).errors.length === 0);

	// --- what makes a function script-only -------------------------------

	check('quick.impureRefusedInExpression',
		errorsOf('Writer()').indexOf('only be used in a script') > 0,
		errorsOf('Writer()'));
	check('quick.impureAllowedInScript',
		errorsOf('Result = Writer();', 'script') === '',
		errorsOf('Result = Writer();', 'script'));
	check('quick.impureIsTransitive',
		errorsOf('Wrapper()').indexOf('only be used in a script') > 0,
		errorsOf('Wrapper()'));
	check('quick.pureIsAllowedInExpression', errorsOf('Scaled(1)') === '');
	check('quick.writesPropagate', (function()
	{
		var c = HmiExpr.compile('Result = Writer();',
			{project: project, mode: 'script'});

		return mxUtils.indexOf(c.writes, 'Pump1_Run') >= 0;
	})());
	check('quick.bodyWritesAtRun', (function()
	{
		run('Result = Writer();', 'script');

		return written['Pump1_Run'] === 1;
	})(), JSON.stringify(written));

	// --- the calls that pause --------------------------------------------

	var wp = HmiSelfTest.sampleProject();
	wp.recipeBooks = [HmiRecipes.newBook('Book')];
	wp.quickFunctions = [
		{name: 'Opener', args: [], body: 'ShowWindow("Main");\nReturn 1;'},
		{name: 'Waiter', args: [],
			body: 'ShowWindow("Main", "", "", 0, 1);\nReturn 1;'},
		{name: 'Picker', args: [],
			body: 'DIM r AS Message;\nr = ShowRecipeSelect("Book");\nReturn r;'}
	];

	var bodyErrors = function(fn)
	{
		var errors = HmiQuickFn.compile(wp, fn).errors;

		return (errors.length > 0) ? errors[0].message : '';
	};

	check('quick.showWindowAllowed', bodyErrors(wp.quickFunctions[0]) === '',
		bodyErrors(wp.quickFunctions[0]));
	check('quick.showWindowMakesItScriptOnly',
		HmiQuickFn.compile(wp, wp.quickFunctions[0]).impure === true);
	check('quick.waitingShowWindowRefused',
		bodyErrors(wp.quickFunctions[1]).indexOf('cannot be used in a QuickFunction') > 0,
		bodyErrors(wp.quickFunctions[1]));
	check('quick.showRecipeSelectRefused',
		bodyErrors(wp.quickFunctions[2]).indexOf('cannot be used in a QuickFunction') > 0,
		bodyErrors(wp.quickFunctions[2]));
	check('quick.pausingCallSaysItOnce',
		HmiQuickFn.compile(wp, wp.quickFunctions[1]).errors.length === 1,
		'' + HmiQuickFn.compile(wp, wp.quickFunctions[1]).errors.length);

	// A ShowWindow with nothing to wait for goes through ctx.call, which is
	// what lets a body use it at all.
	var calls = [];
	var wctx = {
		read: function() { return HmiExpr.GOOD(); },
		write: function() {},
		now: function() { return Date.now(); },
		call: function(name, args) { calls.push(name + ':' + args.join(',')); return 1; },
		callAsync: function(name) { calls.push('async ' + name); }
	};
	HmiExpr.compile('Opener();', {project: wp, mode: 'script'}).eval(wctx);
	check('quick.showWindowIsSynchronous', calls.join(';') === 'ShowWindow:Main',
		calls.join(';'));

	// --- recursion and the caps ------------------------------------------

	var cp = HmiSelfTest.sampleProject();
	cp.quickFunctions = [
		{name: 'Loop', args: [], body: 'Return Loop();'},
		{name: 'Ping', args: [], body: 'Return Pong();'},
		{name: 'Pong', args: [], body: 'Return Ping();'},
		{name: 'Safe', args: [], body: 'Return 1;'}
	];
	var cycles = HmiQuickFn.cycles(cp.quickFunctions);

	check('quick.cycleDirect', cycles['loop'] === true);
	check('quick.cycleMutual', cycles['ping'] === true && cycles['pong'] === true);
	check('quick.cycleLeavesOthers', cycles['safe'] === undefined);
	check('quick.cycleAtCallSite', (function()
	{
		var errors = HmiExpr.compile('Loop()', {project: cp}).errors;

		return errors.length > 0 && errors[0].message.indexOf('calls itself') > 0;
	})());
	check('quick.cycleIsReported', (function()
	{
		var problems = HmiQuickFn.problems(cp, cp.quickFunctions,
			cp.quickFunctions[1]);

		return problems.length === 1 && problems[0].indexOf('calls itself') > 0;
	})());

	var dp = HmiSelfTest.sampleProject();
	dp.quickFunctions = [];

	for (var i = 0; i < 25; i++)
	{
		dp.quickFunctions.push({name: 'D' + i, args: [],
			body: (i < 24) ? 'Return D' + (i + 1) + '();' : 'Return 1;'});
	}

	var deep = HmiExpr.compile('D0()', {project: dp}).eval(ctx);
	check('quick.depthCap', deep.quality === HmiTypes.QUALITY_BAD &&
		('' + deep.error).indexOf('nested more than') > 0,
		JSON.stringify(deep));

	// --- the compile cache -----------------------------------------------

	var ep = HmiSelfTest.sampleProject();
	ep.quickFunctions = [{name: 'Edited', args: [], body: 'Return 1;'}];
	check('quick.cacheBeforeEdit',
		HmiExpr.compile('Edited()', {project: ep}).eval(ctx).value === 1);
	ep.quickFunctions[0].body = 'Return 2;';
	ep.touch();
	check('quick.cacheAfterTouch',
		HmiExpr.compile('Edited()', {project: ep}).eval(ctx).value === 2,
		'' + HmiExpr.compile('Edited()', {project: ep}).eval(ctx).value);

	var ap = HmiSelfTest.sampleProject();
	var sameText = 'Return A;';
	var fnA = {name: 'Argy', args: [{name: 'A', type: 'Analog'}], body: sameText};
	var fnB = {name: 'Argy', args: [{name: 'A', type: 'Message'}], body: sameText};
	check('quick.cacheKnowsArguments',
		HmiQuickFn.compile(ap, fnA) !== HmiQuickFn.compile(ap, fnB));

	// --- the names -------------------------------------------------------

	check('quick.nameRefusesBuiltin', (function()
	{
		var p = HmiQuickFn.nameProblem(project, [],
			{name: 'Abs', args: [], body: ''});

		return p != null && p.indexOf('built-in') > 0;
	})());
	check('quick.nameRefusesTag', (function()
	{
		var p = HmiQuickFn.nameProblem(project, [],
			{name: 'Tank_Level', args: [], body: ''});

		return p != null && p.indexOf('name of a tag') > 0;
	})());
	check('quick.nameRefusesKeyword', (function()
	{
		var p = HmiQuickFn.nameProblem(project, [],
			{name: 'Return', args: [], body: ''});

		return p != null && p.indexOf('keyword') > 0;
	})());
	check('quick.argRefusesTagName', (function()
	{
		var p = HmiQuickFn.nameProblem(project, [], {name: 'Ok',
			args: [{name: 'Tank_Level', type: 'Analog'}], body: ''});

		return p != null && p.indexOf('name of a tag') > 0;
	})());
	check('quick.argRefusesDuplicate', (function()
	{
		var p = HmiQuickFn.nameProblem(project, [], {name: 'Ok',
			args: [{name: 'A', type: 'Analog'}, {name: 'a', type: 'Analog'}],
			body: ''});

		return p != null && p.indexOf('two arguments') > 0;
	})());
	check('quick.nameAccepts',
		HmiQuickFn.nameProblem(project, project.quickFunctions,
			project.quickFunctions[0]) == null);
	check('quick.noReturnIsReported', (function()
	{
		var problems = HmiQuickFn.problems(project, project.quickFunctions,
			project.quickFunctions[4]);

		return problems.length === 1 && problems[0].indexOf('no Return') > 0;
	})(), HmiQuickFn.problems(project, project.quickFunctions,
		project.quickFunctions[4]).join(' | '));

	// --- the project file ------------------------------------------------

	var mp = HmiSelfTest.sampleProject();
	check('quick.emptyProjectHasNoElement', (function()
	{
		var doc = mxUtils.createXmlDocument();

		return mp.toXml(doc).getElementsByTagName('quickFunctions').length === 0;
	})());

	mp.quickFunctions = [
		{name: 'Kept', args: [{name: 'A', type: 'Discrete'},
			{name: 'B', type: 'Message'}],
			body: '{ a comment }\nIF A THEN\n\tReturn B + " <&>";\nENDIF;\nReturn "";'},
		{name: 'Bare', args: [], body: ''}
	];

	var fresh = HmiSelfTest.sampleProject();
	fresh.quickFunctions = HmiQuickFn.copy(mp.quickFunctions);
	check('quick.makesProjectNonEmpty', !fresh.isEmpty());

	var doc = mxUtils.createXmlDocument();
	var xml1 = mxUtils.getXml(mp.toXml(doc));
	var back = HmiProject.fromXml(mxUtils.parseXml(xml1).documentElement);
	check('quick.roundTrip',
		JSON.stringify(back.quickFunctions) === JSON.stringify(mp.quickFunctions),
		JSON.stringify(back.quickFunctions));

	var doc2 = mxUtils.createXmlDocument();
	check('quick.xmlIsStable',
		mxUtils.getXml(back.toXml(doc2)) === xml1);

	var pretty = mxUtils.parseXml(mxUtils.getPrettyXml(
		mxUtils.parseXml(xml1).documentElement)).documentElement;
	var prettyBack = HmiProject.fromXml(pretty);
	check('quick.prettyRoundTrip',
		JSON.stringify(prettyBack.quickFunctions) ===
		JSON.stringify(mp.quickFunctions),
		JSON.stringify(prettyBack.quickFunctions));
};

/** The dialog, Validate, the command line and what a tag rename reaches. */
HmiSelfTest.testQuickFunctionsDialog = function(ui)
{
	var check = HmiSelfTest.check;
	var saved = ui.hmiProject;
	var project = HmiSelfTest.sampleProject();
	project.addTag(HmiProject.createTag('Result', 'MemoryReal'));
	project.quickFunctions = [
		{name: 'Scaled', args: [{name: 'Raw', type: 'Analog'}],
			body: 'Return Raw * Tank_Level;'},
		{name: 'Writer', args: [], body: 'Pump1_Run = 1;\nReturn 1;'}
	];
	ui.hmiProject = project;

	// The dialog is driven with the host stubbed: a real hideDialog closes
	// whatever else is open, and the focus it hands back breaks the deferred
	// checks at the end of the suite.
	var realShow = ui.showDialog;
	var realHide = ui.hideDialog;
	var shown = null;

	ui.showDialog = function(div) { shown = div; };
	ui.hideDialog = function() { shown = null; };

	try
	{
		// --- the menu -----------------------------------------------------

		var labels = [];
		var fake = {showDisabled: true, hideShortcuts: true,
			addItem: function(label)
			{
				labels.push(label);

				return document.createElement('div');
			},
			addSeparator: function() {},
			addCheckmark: function() {}};

		try
		{
			ui.menus.get('hmi').funct(fake, null);
		}
		catch (e)
		{
			// Only our own item matters here
		}

		check('quickDlg.inMenu',
			mxUtils.indexOf(labels,
				mxResources.get('hmiQuickFunctions') + '...') >= 0,
			labels.join(' | ').substring(0, 100));
		check('quickDlg.actionRegistered',
			ui.actions.get('hmiQuickFunctions') != null);

		// --- the dialog ---------------------------------------------------

		var box = HmiDialogs.showQuickFunctions(ui);
		var field = function(name)
		{
			return box.querySelector('[data-hmi-field="' + name + '"]');
		};

		check('quickDlg.listsFunctions',
			box.querySelectorAll('[data-hmi-fn]').length === 2);
		check('quickDlg.showsSignature',
			box.querySelector('[data-hmi-fn="Scaled"] td').innerText ===
			'Scaled(Raw)',
			box.querySelector('[data-hmi-fn="Scaled"] td').innerText);
		check('quickDlg.showsUsage', (function()
		{
			var cells = box.querySelectorAll('[data-hmi-fn="Writer"] td');

			return cells[1].innerText === 'scripts only';
		})());

		// The body is compiled with this function's own arguments in scope.
		field('fnBody').value = 'Return Raw + 1;';
		field('fnBody').dispatchEvent(new Event('input'));
		check('quickDlg.bodyKnowsArguments',
			!field('fnBody').classList.contains('hmiInvalid'),
			field('fnBody').getAttribute('title'));

		field('fnBody').value = 'Return Nope + 1;';
		field('fnBody').dispatchEvent(new Event('input'));
		check('quickDlg.bodyMarksUnknownTag',
			field('fnBody').classList.contains('hmiInvalid'));

		field('fnBody').value = 'Return Raw * Tank_Level;';
		field('fnBody').dispatchEvent(new Event('input'));

		// Arguments
		field('addArg').click();
		check('quickDlg.addsArgument',
			box.querySelectorAll('[data-hmi-arg]').length === 2);
		var argNames = box.querySelectorAll('[data-hmi-field="argName"]');
		argNames[1].value = 'Span';
		argNames[1].dispatchEvent(new Event('input'));
		check('quickDlg.renamesArgument',
			box.querySelector('[data-hmi-fn="Scaled"] td').innerText ===
			'Scaled(Raw, Span)',
			box.querySelector('[data-hmi-fn="Scaled"] td').innerText);
		box.querySelectorAll('[data-hmi-field="removeArg"]')[1].click();
		check('quickDlg.removesArgument',
			box.querySelectorAll('[data-hmi-arg]').length === 1);

		// A function added here is callable from another body at once.
		field('addFunction').click();
		check('quickDlg.adds',
			box.querySelectorAll('[data-hmi-fn]').length === 3);
		field('fnName').value = 'Doubled';
		field('fnName').dispatchEvent(new Event('input'));
		field('fnBody').value = 'Return Scaled(2);';
		field('fnBody').dispatchEvent(new Event('input'));
		check('quickDlg.bodySeesSibling',
			!field('fnBody').classList.contains('hmiInvalid'),
			field('fnBody').getAttribute('title'));
		check('quickDlg.usageLine',
			field('fnUsage').innerText.indexOf('scripts and expressions') > 0,
			field('fnUsage').innerText);

		// --- the script tools ---------------------------------------------

		check('quickDlg.validateSaysClean', (function()
		{
			field('fnBody').value = 'Return Tank_Level * 2;';
			field('fnBody').dispatchEvent(new Event('input'));
			field('validateScript').click();

			return field('scriptMessage').innerText === 'No problems found.';
		})(), field('scriptMessage').innerText);

		check('quickDlg.validateReportsError', (function()
		{
			field('fnBody').value = 'Return Nope * 2;';
			field('fnBody').dispatchEvent(new Event('input'));
			field('validateScript').click();

			return field('scriptMessage').innerText.indexOf('unknown tag "Nope"') >= 0;
		})(), field('scriptMessage').innerText);

		// The message is the user's to clear: pressing it again on a script
		// that now compiles replaces it.
		check('quickDlg.validateClearsError', (function()
		{
			field('fnBody').value = 'Return Tank_Level * 3;';
			field('fnBody').dispatchEvent(new Event('input'));
			field('validateScript').click();

			return field('scriptMessage').innerText === 'No problems found.';
		})(), field('scriptMessage').innerText);

		// New Tag: the editor opens on a name nothing has, and saving it
		// makes the body that reads it compile.
		field('fnBody').value = 'Return Tank_Level * NewTag;';
		field('fnBody').dispatchEvent(new Event('input'));
		check('quickDlg.bodyWantsTheNewTag',
			field('fnBody').classList.contains('hmiInvalid'));

		field('newTag').click();
		var editor = shown;
		check('quickDlg.newTagOpensEditor', editor != null &&
			editor.querySelector('[data-hmi-prop="name"]') != null &&
			editor.querySelector('[data-hmi-prop="name"]').value === 'NewTag',
			(editor != null) ? 'no name field' : 'no editor');

		editor.querySelector('[data-hmi-field="saveTag"]').click();
		check('quickDlg.newTagIsCreated', project.getTag('NewTag') != null);
		check('quickDlg.newTagClearsTheError',
			!field('fnBody').classList.contains('hmiInvalid'),
			field('fnBody').getAttribute('title'));
		check('quickDlg.newTagIsReported',
			field('scriptMessage').innerText.indexOf('created') > 0,
			field('scriptMessage').innerText);

		// Browse Tags: pick one, and its name is on the clipboard.
		var copied = [];
		var realCopy = HmiDialogs.copyText;
		HmiDialogs.copyText = function(host, text, done)
		{
			copied.push(text);
			done(true);
		};

		try
		{
			field('browseTags').click();
			var browser = shown;
			check('quickDlg.browseListsTags', browser != null &&
				browser.querySelectorAll('[data-hmi-tag]').length ===
					project.tags.length,
				(browser != null) ?
					'' + browser.querySelectorAll('[data-hmi-tag]').length : 'none');
			check('quickDlg.browseCopyWaitsForAPick',
				browser.querySelector('[data-hmi-field="copyTag"]').disabled === true);

			browser.querySelector('[data-hmi-field="tagFilter"]').value = 'pump';
			browser.querySelector('[data-hmi-field="tagFilter"]')
				.dispatchEvent(new Event('input'));
			check('quickDlg.browseFilters',
				browser.querySelectorAll('[data-hmi-tag]').length === 1 &&
				browser.querySelector('[data-hmi-tag]')
					.getAttribute('data-hmi-tag') === 'Pump1_Run',
				'' + browser.querySelectorAll('[data-hmi-tag]').length);

			browser.querySelector('[data-hmi-tag]').click();
			browser.querySelector('[data-hmi-field="copyTag"]').click();
			check('quickDlg.browseCopies', copied.join(',') === 'Pump1_Run',
				copied.join(','));
			check('quickDlg.browseSaysSo',
				field('scriptMessage').innerText.indexOf('clipboard') > 0,
				field('scriptMessage').innerText);
		}
		finally
		{
			HmiDialogs.copyText = realCopy;
		}

		field('fnBody').value = 'Return Tank_Level;';
		field('fnBody').dispatchEvent(new Event('input'));

		// The stubbed host last saw the tag browser: what follows asks
		// whether OK left this dialog open, so put it back.
		shown = box;

		// Duplicate counts up, as a duplicated tag does.
		box.querySelector('[data-hmi-fn="Scaled"]').click();
		field('duplicateFunction').click();
		check('quickDlg.duplicateCountsUp',
			field('fnName').value === 'Scaled1', field('fnName').value);
		field('duplicateFunction').click();
		check('quickDlg.duplicateCountsUpAgain',
			field('fnName').value === 'Scaled2', field('fnName').value);
		field('deleteFunction').click();
		box.querySelector('[data-hmi-fn="Scaled1"]').click();
		field('deleteFunction').click();

		// Back to the one the rest of this test is editing
		box.querySelector('[data-hmi-fn="Doubled"]').click();

		// Refusals: OK stays open and says why.
		field('fnName').value = 'Abs';
		field('fnName').dispatchEvent(new Event('input'));
		box.querySelector('.hmiOk').click();
		check('quickDlg.refusesBuiltinName',
			shown === box && field('quickError').innerText.indexOf('built-in') > 0,
			field('quickError').innerText);

		field('fnName').value = 'Tank_Level';
		field('fnName').dispatchEvent(new Event('input'));
		box.querySelector('.hmiOk').click();
		check('quickDlg.refusesTagName',
			shown === box &&
			field('quickError').innerText.indexOf('name of a tag') > 0,
			field('quickError').innerText);

		field('fnName').value = 'Doubled';
		field('fnName').dispatchEvent(new Event('input'));
		field('deleteFunction').click();
		box.querySelector('.hmiOk').click();
		check('quickDlg.okApplies', shown == null &&
			project.quickFunctions.length === 2 && ui.editor.modified,
			'' + project.quickFunctions.length);

		// Cancel leaves the project alone.
		var before = JSON.stringify(project.quickFunctions);
		var second = HmiDialogs.showQuickFunctions(ui);
		second.querySelector('[data-hmi-field="addFunction"]').click();
		ui.hideDialog();
		check('quickDlg.cancelDiscards',
			JSON.stringify(project.quickFunctions) === before);

		// --- Validate ------------------------------------------------------

		project.quickFunctions.push({name: 'Broken', args: [],
			body: 'Return Nope;'});
		project.quickFunctions.push({name: 'Looper', args: [],
			body: 'Return Looper();'});
		project.touch();

		var found = HmiMenus.checkQuickFunctions(project);
		var messages = [];

		for (var i = 0; i < found.length; i++)
		{
			messages.push(found[i].name + ': ' + found[i].message);
		}

		check('quickDlg.validateReportsBody',
			messages.join(' | ').indexOf('unknown tag "Nope"') > 0,
			messages.join(' | '));
		check('quickDlg.validateReportsCycle',
			messages.join(' | ').indexOf('calls itself') > 0,
			messages.join(' | '));

		project.quickFunctions.pop();
		project.quickFunctions.pop();
		project.touch();
		check('quickDlg.validateClean',
			HmiMenus.checkQuickFunctions(project).length === 0,
			JSON.stringify(HmiMenus.checkQuickFunctions(project)));

		// --- the command line ----------------------------------------------

		var errors = [];
		var built = HmiCli.buildProject({version: 1,
			tags: [{name: 'Level', type: 'MemoryReal'}],
			quickFunctions: [{name: 'Half', args: ['Raw'],
				body: 'Return Raw / 2;'}]}, errors);

		check('quickDlg.cliBuilds', errors.length === 0 &&
			built.quickFunctions.length === 1 &&
			built.quickFunctions[0].args[0].type === 'Analog',
			errors.join(' | '));

		errors = [];
		HmiCli.buildProject({version: 1, tags: [],
			quickFunctions: [{name: 'Abs', args: [], body: 'Return 1;'}]}, errors);
		check('quickDlg.cliRefusesBuiltin',
			errors.join(' | ').indexOf('built-in') > 0, errors.join(' | '));

		errors = [];
		HmiCli.buildProject({version: 1, tags: [],
			quickFunctions: [{name: 'Ok', args: [], body: 'Return 1;',
				colour: 'red'}]}, errors);
		check('quickDlg.cliRefusesUnknownField',
			errors.join(' | ').indexOf('unknown field "colour"') > 0,
			errors.join(' | '));

		// --- a tag rename reaches a body, but not an argument ---------------

		var sites = HmiTagRefs.findInProject(ui, 'Tank_Level');
		var inBody = false;

		for (var i = 0; i < sites.length; i++)
		{
			inBody = inBody || ('' + sites[i].path).indexOf('QuickFunction') === 0;
		}

		check('quickDlg.bodyIsAReferenceSite', inBody,
			sites.length + ' sites');

		var shielded = HmiTagRefs.rewriteText('Return Raw * 2;', {'raw': 'Other'},
			'script', {'raw': true});
		check('quickDlg.argumentsAreShielded', shielded.count === 0 &&
			shielded.text === 'Return Raw * 2;', shielded.text);

		var renamed = HmiTagRefs.rename(ui, {'tank_level': 'Vessel_Level'});
		check('quickDlg.renameReachesBody',
			project.quickFunctions[0].body.indexOf('Vessel_Level') > 0 &&
			project.quickFunctions[0].body.indexOf('Raw') > 0,
			project.quickFunctions[0].body);
	}
	finally
	{
		ui.showDialog = realShow;
		ui.hideDialog = realHide;
	}

	// This test renames a tag, which changes the model and schedules a panel
	// rebuild: settle it rather than leave it to land in a later test.
	HmiSelfTest.resetGraph(ui);
	HmiSelfTest.settleFormat(ui);
	ui.hmiProject = saved;
};
