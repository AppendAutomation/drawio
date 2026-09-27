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
		HmiSelfTest.testProjectRoundTrip();
		HmiSelfTest.testCellLinks(ui);
		HmiSelfTest.testFileRoundTrip(ui);
		HmiSelfTest.testFilenames(ui);
		HmiSelfTest.testBrand(ui);
		HmiSelfTest.testFormatTab(ui);
		HmiSelfTest.testPivotPanel(ui);
		HmiSelfTest.testRuntime(ui);
		HmiSelfTest.testMenusAndDialogs(ui);
		HmiSelfTest.testPanelLayout(ui);
		HmiSelfTest.testMovement(ui);
		HmiSelfTest.testM2Interaction(ui);
		HmiSelfTest.testDiscreteText(ui);
		HmiSelfTest.testScriptFields(ui);
		HmiSelfTest.testAnimationClipboard(ui);
		HmiSelfTest.testKeypad(ui);
		HmiSelfTest.testWindows(ui);
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
 * Orientation's centre of rotation in the Animation panel: page coordinates
 * in the fields, an offset from the object's centre in the link, a marker on
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

	// The object's centre is now (290, 240)
	check('pivot.picked', link().pivotDx === '110' && link().pivotDy === '-140', JSON.stringify(link()));
	check('pivot.pickEnds', ui.hmiPivotPick == null && graph.container.style.cursor !== 'crosshair');
	check('pivot.pickKeepsSelection', graph.getSelectionCell() === cell);

	format.immediateRefresh();
	field('pivot').value = 'center';
	field('pivot').dispatchEvent(new Event('change'));
	format.immediateRefresh();
	check('pivot.backToCentre', link().pivot == null && link().pivotDx == null &&
		field('pivotX') == null && graph.container.querySelectorAll('.hmiPivotMarker').length === 0);

	graph.clearSelection();
	graph.removeCells([cell]);
	format.immediateRefresh();
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

	// At 90 degrees clockwise the centre swings from left of the point to
	// above it: 50 right and 50 up, while the shape itself turns 90
	var rotP = graph.view.getState(cells.rotP);
	var pScale = graph.view.scale;

	HmiSelfTest.check('m2.orientationPivot',
		rotP != null && parseFloat(rotP.style[mxConstants.STYLE_ROTATION]) === 90 &&
		Math.abs((rotP.x - design.rotP.x) - 50 * pScale) < 1 &&
		Math.abs((rotP.y - design.rotP.y) + 50 * pScale) < 1,
		(rotP != null) ? 'dx = ' + (rotP.x - design.rotP.x) + ', dy = ' + (rotP.y - design.rotP.y) +
			', rotation = ' + rotP.style[mxConstants.STYLE_ROTATION] + ', scale = ' + pScale : 'none');

	// The default stays the object's own centre: no displacement
	var rot0 = graph.view.getState(cells.rot);

	HmiSelfTest.check('m2.orientationCentreDefault',
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

	// The open dialog offers ours alongside drawio.
	var filters = HmiFile.withHmiFilter([
		{name: 'Diagram', extensions: ['drawio', 'xml']}]);

	HmiSelfTest.check('name.openFilterIncludesHmi',
		mxUtils.indexOf(filters[0].extensions, 'ahmi') >= 0 &&
		mxUtils.indexOf(filters[0].extensions, 'drawio-hmi') >= 0,
		filters[0].extensions.join(','));

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

		HmiMenus.stop(ui);
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
