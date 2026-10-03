/**
 * Indirect tags (IndirectDiscrete, IndirectAnalog, IndirectMessage): a tag
 * with no value of its own that a script points at another tag with
 * LinkIndirectTag("Indirect", "Tag"). Reading or writing it then reads or
 * writes that tag, dotfields included; a new call replaces the link.
 *
 * The links live in the Run's HmiDriverHub, which resolves them for every
 * window, alarm view and recipe book. This is the script side: the checks,
 * shared with the expression compiler, and the function itself.
 */
HmiIndirect = function(project, hub, options)
{
	this.project = project;
	this.hub = hub;
	this.options = options || {};
};

HmiIndirect.FUNCTION = 'LinkIndirectTag';

/**
 * Why indirect cannot be linked to target, or null when it can. Either
 * name may be null to check only the other.
 */
HmiIndirect.check = function(project, indirect, target)
{
	var itag = null;

	if (indirect != null)
	{
		if (('' + indirect).trim() === '')
		{
			return 'The indirect tag name is empty.';
		}

		itag = project.getTag(('' + indirect).trim());

		if (itag == null)
		{
			return 'There is no tag named "' + indirect + '".';
		}

		if (!HmiTypes.isIndirect(itag.type))
		{
			return '"' + itag.name + '" is a ' + itag.type + ' tag, not an indirect tag.';
		}
	}

	if (target != null)
	{
		if (('' + target).trim() === '')
		{
			return 'The name of the tag to link to is empty.';
		}

		var ttag = (HmiTypes.systemTag(('' + target).trim()) == null) ? project.getTag(('' + target).trim()) : null;

		if (ttag == null)
		{
			return 'There is no tag named "' + target + '".';
		}

		if (HmiTypes.isIndirect(ttag.type))
		{
			return '"' + ttag.name + '" is an indirect tag itself; link to the tag it stands for.';
		}

		if (itag != null && !HmiTypes.indirectAccepts(itag.type, ttag.type))
		{
			return '"' + itag.name + '" is an ' + itag.type + ' tag and cannot be linked to "' +
				ttag.name + '", a ' + ttag.type + ' tag.';
		}
	}

	return null;
};

/** The tag an indirect tag is linked to, or null. Other names are themselves. */
HmiIndirect.prototype.resolve = function(name)
{
	return this.hub.resolve(name);
};

/** The indirect tags now linked to any of these names. */
HmiIndirect.prototype.aliases = function(names)
{
	var out = [];
	var wanted = {};

	for (var i = 0; i < names.length; i++)
	{
		wanted[('' + names[i]).toLowerCase()] = true;
	}

	for (var key in this.hub.links)
	{
		if (wanted[this.hub.links[key].target.toLowerCase()])
		{
			out.push(this.hub.links[key].indirect);
		}
	}

	return out;
};

/** LinkIndirectTag(indirect, target): 1, or 0 with the reason shown to the operator. */
HmiIndirect.prototype.call = function(name, args)
{
	var indirect = HmiExpr.text(args[0]).trim();
	var target = HmiExpr.text(args[1]).trim();
	var problem = HmiIndirect.check(this.project, indirect, target);
	var call = HmiRecipes.describeCall(HmiIndirect.FUNCTION, [HmiExpr.text(args[0]), HmiExpr.text(args[1])]);

	if (problem != null)
	{
		HmiLog.warn('indirect: ' + call + ' failed: ' + problem);

		if (typeof HmiRuntimeApp !== 'undefined' && HmiRuntimeApp.isActive())
		{
			HmiRuntimeApp.log('warn', call + ' failed: ' + problem);
		}

		if (this.options.report != null)
		{
			this.options.report(call, problem);
		}
		else if (this.options.ui != null)
		{
			HmiDialogs.queueFunctionError(this.options.ui, call, problem);
		}

		return 0;
	}

	var itag = this.project.getTag(indirect);
	var ttag = this.project.getTag(target);
	this.hub.link(itag.name, ttag.name);
	HmiLog.log('indirect: ' + itag.name + ' -> ' + ttag.name);

	return 1;
};
