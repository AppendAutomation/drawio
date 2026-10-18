/**
 * Tag types, quality codes, and the animation link registry.
 *
 * The link registry is the single place that maps this fork's symbolic link
 * keys to the classic InTouch numeric codes (code = family * 100 + subtype).
 * The numeric code matters only at the InTouch import/export boundary;
 * everything else in the fork addresses links by their symbolic key so that
 * saved files stay readable and diffable.
 */
HmiTypes = function() {};

// ---------------------------------------------------------------- tag types

HmiTypes.TAG_TYPES = [
	'MemoryDiscrete', 'MemoryInteger', 'MemoryReal', 'MemoryMessage',
	'IODiscrete', 'IOInteger', 'IOReal', 'IOMessage',
	'IndirectDiscrete', 'IndirectAnalog', 'IndirectMessage'
];

HmiTypes.isIO = function(type)
{
	return type != null && type.indexOf('IO') === 0;
};

HmiTypes.isDiscrete = function(type)
{
	return type === 'MemoryDiscrete' || type === 'IODiscrete' || type === 'IndirectDiscrete';
};

HmiTypes.isMessage = function(type)
{
	return type === 'MemoryMessage' || type === 'IOMessage' || type === 'IndirectMessage';
};

/**
 * An indirect tag holds no value of its own: at run time LinkIndirectTag
 * points it at another tag, and reading or writing it reads or writes that
 * tag (HmiDriverHub).
 */
HmiTypes.isIndirect = function(type)
{
	return type != null && type.indexOf('Indirect') === 0;
};

/** Whether an indirect tag of this type may be linked to a tag of that type. */
HmiTypes.indirectAccepts = function(indirectType, type)
{
	if (!HmiTypes.isIndirect(indirectType) || type == null || HmiTypes.isIndirect(type))
	{
		return false;
	}

	return (HmiTypes.isDiscrete(indirectType) && HmiTypes.isDiscrete(type)) ||
		(HmiTypes.isMessage(indirectType) && HmiTypes.isMessage(type)) ||
		(HmiTypes.isAnalog(indirectType) && HmiTypes.isAnalog(type));
};

HmiTypes.isAnalog = function(type)
{
	return type != null && !HmiTypes.isDiscrete(type) && !HmiTypes.isMessage(type);
};

/** True for types whose value is a whole number. */
HmiTypes.isInteger = function(type)
{
	return type === 'MemoryInteger' || type === 'IOInteger';
};

// ------------------------------------------------------------------ quality
// OPC DA scale. Deliberately numeric and ordered so that propagating the
// minimum across an expression's operands gives the semantics an HMI needs:
// any input bad makes the whole result bad.

HmiTypes.QUALITY_BAD = 0;
HmiTypes.QUALITY_UNCERTAIN = 64;
HmiTypes.QUALITY_GOOD = 192;

HmiTypes.qualityName = function(q)
{
	return (q >= HmiTypes.QUALITY_GOOD) ? 'Good' :
		((q >= HmiTypes.QUALITY_UNCERTAIN) ? 'Uncertain' : 'Bad');
};

// -------------------------------------------------------------- dot fields
// Fields readable off a tag reference. Anything not listed here is a compile
// error rather than a runtime surprise.

HmiTypes.DOTFIELDS = {
	'Value': true, 'Name': true, 'Quality': true, 'TimeDate': true,
	'MinEU': true, 'MaxEU': true, 'MinRaw': true, 'MaxRaw': true,
	'EngUnits': true, 'Comment': true,
	'InAlarm': true, 'AlarmMostUrgentInAlarm': true, 'Acked': true
};

/**
 * What the dotfields that describe a tag, rather than carry its value, say
 * about it. Value, Quality and TimeDate are not here: they are the reading
 * itself, and only the caller holds that.
 *
 * One definition, because two places read these: a runtime (HmiRuntime's
 * readField) and the database manager, which puts a bind list's dotfields
 * into an insert.
 */
HmiTypes.describe = function(tag, inAlarm, acked)
{
	return {Name: tag.name, MinEU: tag.minEU, MaxEU: tag.maxEU,
		MinRaw: tag.minRaw, MaxRaw: tag.maxRaw, EngUnits: tag.engUnits,
		Comment: tag.comment, InAlarm: inAlarm ? 1 : 0,
		AlarmMostUrgentInAlarm: inAlarm ? 1 : 0, Acked: acked ? 1 : 0};
};

// ------------------------------------------------------------ system tags
// Supplied by the runtime rather than the dictionary. The names are reserved:
// no dictionary tag may take one. Each entry's provider says what answers it:
// the alarm manager, security, or the clock, which needs no Run at all.

HmiTypes.SYSTEM_TAGS = {
	'_AlarmsActive': {type: 'MemoryInteger', readOnly: true, provider: 'alarms',
		comment: 'Number of active alarms'},
	'_AlarmsUnacked': {type: 'MemoryInteger', readOnly: true, provider: 'alarms',
		comment: 'Number of unacknowledged alarms'},
	'_AckAll': {type: 'MemoryDiscrete', readOnly: false, provider: 'alarms',
		comment: 'Write 1 to acknowledge all alarms'},
	'_Username': {type: 'MemoryMessage', readOnly: true, provider: 'security',
		comment: 'The logged-in user, "None" when nobody is'},
	'_AccessLevel': {type: 'MemoryInteger', readOnly: true, provider: 'security',
		comment: "The logged-in user's access level, 0 when nobody is"},
	'_DateString': {type: 'MemoryMessage', readOnly: true, provider: 'clock',
		comment: "Today's date, as YYYY-MM-DD"},
	'_TimeString': {type: 'MemoryMessage', readOnly: true, provider: 'clock',
		comment: 'The time of day, as HH:MM:SS'},
	'_DateTime': {type: 'MemoryMessage', readOnly: true, provider: 'clock',
		comment: 'The date and the time, as YYYY-MM-DD HH:MM:SS.mmm'},
	'_Year': {type: 'MemoryInteger', readOnly: true, provider: 'clock',
		comment: 'The year, all four digits'},
	'_Month': {type: 'MemoryInteger', readOnly: true, provider: 'clock',
		comment: 'The month, 1 to 12'},
	'_Day': {type: 'MemoryInteger', readOnly: true, provider: 'clock',
		comment: 'The day of the month, 1 to 31'},
	'_Hour': {type: 'MemoryInteger', readOnly: true, provider: 'clock',
		comment: 'The hour, 0 to 23'},
	'_Minute': {type: 'MemoryInteger', readOnly: true, provider: 'clock',
		comment: 'The minute, 0 to 59'},
	'_Second': {type: 'MemoryInteger', readOnly: true, provider: 'clock',
		comment: 'The second, 0 to 59'},
	'_Msec': {type: 'MemoryInteger', readOnly: true, provider: 'clock',
		comment: 'The millisecond within the second, 0 to 999'}
};

/** The names by their lower-case spelling: systemTag is on every value read. */
HmiTypes.SYSTEM_INDEX = (function()
{
	var index = {};

	for (var key in HmiTypes.SYSTEM_TAGS)
	{
		index[key.toLowerCase()] = key;
	}

	return index;
})();

/** The system tag's canonical name, or null. Case-insensitive like tag names. */
HmiTypes.systemTag = function(name)
{
	if (typeof name !== 'string')
	{
		return null;
	}

	var lower = name.toLowerCase();

	// hasOwnProperty, or a tag named "constructor" would find Object's
	return (Object.prototype.hasOwnProperty.call(HmiTypes.SYSTEM_INDEX, lower)) ?
		HmiTypes.SYSTEM_INDEX[lower] : null;
};

// ------------------------------------------------------ the date and the time

/** A date field, zero-padded to its width. */
HmiTypes.pad = function(n, width)
{
	var text = '' + n;

	while (text.length < (width || 2))
	{
		text = '0' + text;
	}

	return text;
};

/** The local date, as YYYY-MM-DD: the one order that reads the same anywhere. */
HmiTypes.dateText = function(d)
{
	return d.getFullYear() + '-' + HmiTypes.pad(d.getMonth() + 1) + '-' + HmiTypes.pad(d.getDate());
};

/** The local time of day, as HH:MM:SS on a 24-hour clock. */
HmiTypes.timeText = function(d)
{
	return HmiTypes.pad(d.getHours()) + ':' + HmiTypes.pad(d.getMinutes()) +
		':' + HmiTypes.pad(d.getSeconds());
};

/**
 * The local date and time, as YYYY-MM-DD HH:MM:SS.mmm. This is the text a
 * date or datetime column takes as it stands (HmiSql.dateText is this
 * function), so a script can stamp a row with _DateTime.
 */
HmiTypes.stampText = function(d)
{
	return HmiTypes.dateText(d) + ' ' + HmiTypes.timeText(d) +
		'.' + HmiTypes.pad(d.getMilliseconds(), 3);
};

/**
 * What each date and time system tag reads. The values are worked out when
 * they are read rather than held, so a script reading _Msec gets the
 * millisecond it asked in; the once-a-second tick (HmiWindowManager's clock)
 * is only what makes a screen showing them repaint.
 *
 * Plant-local time throughout, as the rest of the application uses it: a row
 * stamped by a script and read back by one reports the same wall clock.
 */
HmiTypes.CLOCK_READERS = {
	'_DateString': function(d) { return HmiTypes.dateText(d); },
	'_TimeString': function(d) { return HmiTypes.timeText(d); },
	'_DateTime': function(d) { return HmiTypes.stampText(d); },
	'_Year': function(d) { return d.getFullYear(); },
	'_Month': function(d) { return d.getMonth() + 1; },
	'_Day': function(d) { return d.getDate(); },
	'_Hour': function(d) { return d.getHours(); },
	'_Minute': function(d) { return d.getMinutes(); },
	'_Second': function(d) { return d.getSeconds(); },
	'_Msec': function(d) { return d.getMilliseconds(); }
};

/** The date and time tags, the names a tick re-evaluates. */
HmiTypes.CLOCK_NAMES = Object.keys(HmiTypes.CLOCK_READERS);

/** A date and time system tag's value, as the expression engine reads it. */
HmiTypes.readClock = function(name, now)
{
	var reader = HmiTypes.CLOCK_READERS[name];

	if (reader == null)
	{
		return {value: null, quality: HmiTypes.QUALITY_BAD, timestamp: Date.now()};
	}

	var when = (now != null) ? now : new Date();

	return {value: reader(when), quality: HmiTypes.QUALITY_GOOD, timestamp: when.getTime()};
};

// ------------------------------------------------------- link type registry

/**
 * Link families, in the order the Animation panel's launcher shows them.
 */
HmiTypes.FAMILIES = [
	{id: 'touch', label: 'Touch Links'},
	{id: 'lineColor', label: 'Line Color'},
	{id: 'fillColor', label: 'Fill Color'},
	{id: 'textColor', label: 'Text Color'},
	{id: 'movement', label: 'Value / Movement'},
	{id: 'display', label: 'Miscellaneous'},
	{id: 'value', label: 'Value Display'}
];

/**
 * key -> {code, family, label, milestone, defaults(), refs, refArrays}
 *
 * `refs` and `refArrays` say which config fields can name a tag, and how the
 * name is written: 'tag' is a bare name, 'expr' an expression and 'script' a
 * script. `refArrays` covers the array-valued holders (a color link's bands, a
 * trend's pens). HmiTagRefs reads them; a field in neither is never a tag
 * reference, which its self test checks against defaults().
 *
 * `milestone` marks which types are wired end to end in M1; later types are
 * registered here so the numeric mapping stays in one place, but the panel
 * only offers those whose milestone is <= HmiTypes.MILESTONE.
 */
HmiTypes.MILESTONE = 2;

HmiTypes.LINKS = {};

HmiTypes.defineLink = function(key, def)
{
	def.key = key;
	def.refs = def.refs || {};
	def.refArrays = def.refArrays || {};
	HmiTypes.LINKS[key] = def;

	return def;
};

(function()
{
	var def = HmiTypes.defineLink;

	// --- colour links. Discrete takes two colours; analog takes a variable
	// --- length band array (see HmiProject for why it is not fixed at 10).

	function discreteColor(key, code, family, label)
	{
		def(key, {code: code, family: family, label: label, milestone: 1,
			refs: {expr: 'expr'},
			defaults: function()
			{
				return {expr: '', on: '#00CC00', off: '#808080'};
			}});
	}

	function analogColor(key, code, family, label)
	{
		def(key, {code: code, family: family, label: label, milestone: 1,
			refs: {expr: 'expr'}, refArrays: {bands: {max: 'expr'}},
			defaults: function()
			{
				return {expr: '', bands: [
					{max: '50', color: '#00CC00'},
					{max: null, color: '#CC0000'}
				]};
			}});
	}

	discreteColor('lineColor.discrete', 201, 'lineColor', 'Line Color / Discrete');
	analogColor('lineColor.analog', 202, 'lineColor', 'Line Color / Analog');
	discreteColor('fillColor.discrete', 301, 'fillColor', 'Fill Color / Discrete');
	analogColor('fillColor.analog', 302, 'fillColor', 'Fill Color / Analog');
	discreteColor('textColor.discrete', 801, 'textColor', 'Text Color / Discrete');
	analogColor('textColor.analog', 802, 'textColor', 'Text Color / Analog');

	// Alarm colour variants are M2; registered for code fidelity only.
	def('lineColor.discreteAlarm', {code: 203, family: 'lineColor', label: 'Line Color / Discrete Alarm', milestone: 2,
		refs: {tag: 'tag'},
		defaults: function()
		{
			return {tag: '', on: '#CC0000', off: '#808080'};
		}});
	def('lineColor.analogAlarm', {code: 204, family: 'lineColor', label: 'Line Color / Analog Alarm', milestone: 2,
		refs: {tag: 'tag'},
		defaults: function()
		{
			return {tag: '', loLo: '#CC0000', low: '#CC8800',
				normal: '#00CC00', high: '#CC8800', hiHi: '#CC0000'};
		}});
	def('fillColor.discreteAlarm', {code: 303, family: 'fillColor', label: 'Fill Color / Discrete Alarm', milestone: 2,
		refs: {tag: 'tag'},
		defaults: function()
		{
			return {tag: '', on: '#CC0000', off: '#808080'};
		}});
	def('fillColor.analogAlarm', {code: 304, family: 'fillColor', label: 'Fill Color / Analog Alarm', milestone: 2,
		refs: {tag: 'tag'},
		defaults: function()
		{
			return {tag: '', loLo: '#CC0000', low: '#CC8800',
				normal: '#00CC00', high: '#CC8800', hiHi: '#CC0000'};
		}});
	def('textColor.discreteAlarm', {code: 803, family: 'textColor', label: 'Text Color / Discrete Alarm', milestone: 2,
		refs: {tag: 'tag'},
		defaults: function()
		{
			return {tag: '', on: '#CC0000', off: '#808080'};
		}});
	def('textColor.analogAlarm', {code: 804, family: 'textColor', label: 'Text Color / Analog Alarm', milestone: 2,
		refs: {tag: 'tag'},
		defaults: function()
		{
			return {tag: '', loLo: '#CC0000', low: '#CC8800',
				normal: '#00CC00', high: '#CC8800', hiHi: '#CC0000'};
		}});

	// --- miscellaneous display

	def('visibility', {code: 581, family: 'display', label: 'Visibility', milestone: 1,
		refs: {expr: 'expr'},
		defaults: function()
		{
			return {expr: '', sense: 'visible'};
		}});

	def('blink', {code: 583, family: 'display', label: 'Blink', milestone: 1,
		refs: {expr: 'expr', rateMs: 'expr'},
		defaults: function()
		{
			return {expr: '', rateMs: '500', attrs: ['fill'],
				fill: '#FF0000', line: '#FFFFFF', text: '#000000', blank: false};
		}});

	// Enable gates every touch link on the object, in the Visibility style:
	// enabled while the expression is true (or false, with sense 'disabled')
	def('enable', {code: 586, family: 'display', label: 'Enable', milestone: 2,
		refs: {expr: 'expr'},
		defaults: function()
		{
			return {expr: '', sense: 'enabled'};
		}});

	// The Recipe List object's settings (HmiRecipes.js): edited in its own
	// section, never offered as a link
	def('recipeList', {code: 9001, family: 'display', label: 'Recipe List', milestone: 99,
		refs: {selectedTag: 'tag', upTag: 'tag', downTag: 'tag'},
		defaults: function()
		{
			return {book: '', title: '', selectedTag: '', upTag: '', downTag: '', arrows: false,
				titleFill: '', titleColor: '', selFill: '', selColor: ''};
		}});

	// The List Box object's settings (HmiList.js): edited in its own section,
	// never offered as a link
	def('list', {code: 9003, family: 'display', label: 'List Box', milestone: 99,
		refs: {selectedTag: 'tag', upTag: 'tag', downTag: 'tag'},
		defaults: function()
		{
			return {name: '', title: '', titleBar: false, items: '', selectedTag: '', upTag: '',
				downTag: '', arrows: false, titleFill: '', titleColor: '', selFill: '', selColor: ''};
		}});

	// The Trend object's settings (HmiTrend.js): edited in its own section,
	// never offered as a link
	def('trend', {code: 9002, family: 'display', label: 'Trend', milestone: 99,
		refArrays: {pens: {tag: 'tag'}},
		defaults: function()
		{
			return {name: '', title: '', spanSec: 600, sampleMs: 1000, refreshMs: 1000, gridColor: '#dde3e8', pens: []};
		}});

	// Superseded by Enable; still applied in existing projects, not offered
	def('disable', {code: 585, family: 'display', label: 'Disable', milestone: 99,
		refs: {expr: 'expr'},
		defaults: function()
		{
			return {expr: ''};
		}});

	// --- value display

	def('valueDisplay', {code: 611, family: 'value', label: 'Value Display', milestone: 1,
		refs: {expr: 'expr'},
		defaults: function()
		{
			return {kind: 'analog', expr: '', format: '0.0', prefix: '',
				suffix: '', onText: '', offText: ''};
		}});

	// --- touch links

	def('userInput', {code: 608, family: 'touch', label: 'User Input', milestone: 1,
		refs: {tag: 'tag', min: 'expr', max: 'expr'},
		defaults: function()
		{
			return {kind: 'analog', tag: '', min: '', max: '',
				prompt: 'Enter value', keypad: true, masked: false};
		}});

	def('pushbutton', {code: 401, family: 'touch', label: 'Pushbutton', milestone: 1,
		refs: {tag: 'tag', enableExpr: 'expr'},
		defaults: function()
		{
			return {kind: 'discrete', tag: '', action: 'toggle', enableExpr: ''};
		}});

	def('pushbutton.action', {code: 402, family: 'touch', label: 'Action Script',
		milestone: 2,
		refs: {onDown: 'script', whileDown: 'script', onUp: 'script',
			everyMs: 'expr'},
		defaults: function()
		{
			return {onDown: '', whileDown: '', onUp: '', everyMs: '1000'};
		}});

	def('showWindow', {code: 403, family: 'touch', label: 'Show Window',
		milestone: 2,
		refs: {enableExpr: 'expr'},
		defaults: function()
		{
			return {window: '', enableExpr: ''};
		}});

	def('hideWindow', {code: 404, family: 'touch', label: 'Hide Window',
		milestone: 2,
		refs: {enableExpr: 'expr'},
		defaults: function()
		{
			return {window: '', enableExpr: ''};
		}});

	function slider(key, code, label)
	{
		def(key, {code: code, family: 'touch', label: label, milestone: 2,
			refs: {tag: 'tag', atMin: 'expr', atMax: 'expr',
				travelMin: 'expr', travelMax: 'expr'},
			defaults: function()
			{
				return {tag: '', atMin: '0', atMax: '100',
					travelMin: '0', travelMax: '100'};
			}});
	}

	slider('slider.horizontal', 501, 'Slider / Horizontal');
	slider('slider.vertical', 511, 'Slider / Vertical');

	// --- geometry, all M2

	// The value/movement family. Every bound is an expression, so a range can
	// track the dictionary rather than being frozen at design time.
	function ranged(key, code, family, label, outMin, outMax, a, b, extra)
	{
		var refs = {expr: 'expr', atMin: 'expr', atMax: 'expr'};
		refs[outMin] = 'expr';
		refs[outMax] = 'expr';

		def(key, {code: code, family: family, label: label, milestone: 2,
			outMin: outMin, outMax: outMax, extra: extra, refs: refs,
			defaults: function()
			{
				var cfg = {expr: '', atMin: '0', atMax: '100'};
				cfg[outMin] = '' + a;
				cfg[outMax] = '' + b;

				for (var k in (extra || {}))
				{
					cfg[k] = extra[k];
				}

				return cfg;
			}});
	}

	ranged('location.horizontal', 521, 'movement', 'Location / Horizontal',
		'offsetMin', 'offsetMax', -100, 100);
	ranged('location.vertical', 531, 'movement', 'Location / Vertical',
		'offsetMin', 'offsetMax', -100, 100);
	// Size links also carry an anchor: the edge that stays put as the object
	// grows. InTouch always scales from the top-left; a bargraph usually wants
	// to grow upward instead, so the edge is a choice here.
	ranged('size.width', 541, 'movement', 'Object Size / Width',
		'pctMin', 'pctMax', 0, 100, {anchor: 'left'});
	ranged('size.height', 551, 'movement', 'Object Size / Height',
		'pctMin', 'pctMax', 0, 100, {anchor: 'top'});
	ranged('percentFill.horizontal', 561, 'movement', 'Percent Fill / Horizontal',
		'pctMin', 'pctMax', 0, 100);
	ranged('percentFill.vertical', 571, 'movement', 'Percent Fill / Vertical',
		'pctMin', 'pctMax', 0, 100);
	ranged('orientation', 720, 'movement', 'Orientation',
		'angleMin', 'angleMax', 0, 360);
})();

/** Link keys available in the current milestone, in registry order. */
HmiTypes.availableLinks = function()
{
	var res = [];

	for (var key in HmiTypes.LINKS)
	{
		if (HmiTypes.LINKS[key].milestone <= HmiTypes.MILESTONE)
		{
			res.push(HmiTypes.LINKS[key]);
		}
	}

	return res;
};

/** Reverse lookup for the InTouch importer. */
HmiTypes.linkByCode = function(code)
{
	for (var key in HmiTypes.LINKS)
	{
		if (HmiTypes.LINKS[key].code === code)
		{
			return HmiTypes.LINKS[key];
		}
	}

	return null;
};
