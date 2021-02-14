/* -----------
| APRIKOS.JS
| @author: Andy Croxall (mitya.uk; github.com/mitya33)
----------- */

'use strict';

(() => {

	//general framework prep
	const frameworkId = 'aprikos',
		frameworkAlias = 'aprk',
		classId = frameworkId[0].toUpperCase()+frameworkId.substr(1),
		complexObjs = [],
		varIdentifier = frameworkAlias+'-var:',
		noRenderElIdentifier = frameworkAlias+'-no-render:',
		symbols = [
			'component',
			'liveAttrsCache',
			'repeaterOrigNodes',
			'events',
			'compFilesCache',
			'compDOMsCache',
			'compJsFuncs',
			'doneCssForCompNames',
			'statesCache',
			'persistentStatesCache',
			'activeIndexedState',
			'repData'
		].reduce((obj, val) => {
			obj[val] = Symbol();
			return obj;
		}, {}),
		routeTypes = ['seg', 'json'],
		compPreRenderAttr = 'data-component-name',
		compRenderedAttr = 'data-'+frameworkAlias+'-comp',
		compRenderedInstanceAttr = 'data-'+frameworkAlias+'-instance',
		repElAttr = 'data-'+frameworkAlias+'-rep-sel',
		repSelAttr = 'data-'+frameworkAlias+'-rep-sel',
		regex = {
			unquotedAttr: /<[a-z]+[^>]* ([a-z][a-z0-9\-_]*)=[^'"][^>]*>/i,
			childComps: /<([A-Z][a-z\d\-]*)\b([^\/]*) ?\/>/g,
			repOrCondChildCompSel: /\b([A-Z][a-z\d\-]*)(?!=["\]])\b/g,
			vars: /\{\{([^\}\|]+)(?:\|(\w+)\(\))?\}\}/g,
			complexType: /\[(?:object Object|function):(\d+)\]/,
			liveAttr: /^[\s\S]+\/@[\w\-]+$/,
			compsFileCompMarker: /^<!-- ?COMPONENT (\w+) ?-->$/gm,
			condOrRepSelNoReachIntoChildComp: /[A-Z][a-zA-Z\d-]* +[a-zA-Z]/,
			pseudo: /::?[\w\-]+/,
			routeDataVars: /^\$rd:/
		};
		regex.varsAsComments = new RegExp(regex.vars.source.replace('\\{\\{', '<!-- ?'+varIdentifier).replace('\\}\\}', ' ?-->').replace('^\\}', '^\\-'), 'g');

	/* ---
	| CONSTRUCTOR - args:
	|	@params (obj)	- object of params, including:
	|		@container (obj; sel)		- a container for the app, either a reference to an HTML element or a selector string pointing to
	|									  one (dflt: 'body')
	|		@noCache (bool)				- if true, components' file contents won't be cached (dflt: false)
	|		@compsPath (str)			- path to location of component files (dflt: '.')
	|		@compsFile (str)			- path to a .html file containing config for all components, rather than each having its own file
	|		@methods (obj)				- object of filter methods that can be used in var placeholders i.e. {{myvar|mymethod()}}
	|		@autoReprocessAttrs (bool)	- whether to auto-process live attributes whenever ::data is written to (dflt: true)
	|		@masterComponent (str)		- the name of the master component (dflt: 'master')
	|		@routes (obj)				- a map of routes data, with keys denoting route IDs and values as objects with route config. See
	|									  ::listenForRoutes() for more.
	|		@reinsCaching (bool; arr)	- whether child components should be reinstated from cache rather than fresh when they are reinstated
	|									  by a parent's reprocessed conditional - true for all components, or an array of component names
	|		@noCacheCompFiles (bool)	- set true to not cache component files, so they're loaded fresh each time (dflt: false)
	|		@data (obj)					- an object of starting data, i.e. props for the master component
	--- */

	window[classId] = window[classId] || function(params) {

		//prep & containers
		window[classId].apps = window[classId].apps || [];
		window[classId].apps.push(this);
		this.appId = window[classId].apps.length - 1;
		this[symbols.compFilesCache] = {};
		this[symbols.compDOMsCache] = window.cache = {};
		this[symbols.compJsFuncs] = {};
		this[symbols.doneCssForCompNames] = [];
		this.components = {};
		this[symbols.events] = {
			rendered: {},
			fullyRendered: {},
			routeChanged: {},
			message: {}
		};
		this.fullyRenderedTracker = {};

		//merge params with defaults and assign to instance
		Object.assign(this, {
			autoReprocessAttrs: true,
			compsPath: '.',
			masterComponent: 'master',
			container: 'body',
			manualConds: false,
			manualAttrs: false
		}, params || {});

		//establish/check app container
		if (typeof this.container == 'string') this.container = document.querySelector(params.container);
		if (!(this.container && this.container.tagName)) return this.error('Container is not an element');

		//validate routes
		const routesIssue = this.validateRoutes();
		if (routesIssue) return this.error(routesIssue);

		//listen for route changes in a@href attrs via "route:" protocol
		this.container.addEventListener('click', evt => {
			if (!evt.target.matches('a[href^="route:"]')) return;
			evt.preventDefault();
			this.components[this.masterComponent][0].go(evt.target.getAttribute('href').replace(/^route:/, ''));
		});

		//single components file rather than separate files? Parse and cache. Also handles special scenario of Aprikos playground, where components data
		//is read from Aprikos.compsContentHook() func.
		const ready = new Promise(res => {
			if (!this.compsFile && typeof window[classId].compsContentHook != 'function') return res();
			if (!window[classId].compsContentHook) {
				const fp = this.compsPath+'/'+this.compsFile.replace(/\.html$/, '')+'.html';
				fetch(fp)
					.then(r => { if (r.ok) return r.text(); else throw 'Could not load components from '+fp+' - check path'; })
					.then(content => {
						if (!regex.compsFileCompMarker.test(content))
							throw 'components file '+fp+' is not properly formatted - components must be preceded by comment in format <!-- COMPONENT MYCOMPONENTNAME -->';
						content.replace(regex.compsFileCompMarker, ($0, compName) => {
							const compContent = content.substr(content.indexOf($0)+$0.length).split(regex.compsFileCompMarker)[0];
							this[symbols.compFilesCache][compName.toLowerCase()] = compContent;
						});
						res();

					})
					.catch(reason => this.error(reason));
			} else {
				let content = window[classId].compsContentHook();
				content && content.replace(regex.compsFileCompMarker, ($0, compName) => {
					const compContent = content.substr(content.indexOf($0)+$0.length).split(regex.compsFileCompMarker)[0];
					this[symbols.compFilesCache][compName.toLowerCase()] = compContent;
				});
				content && res();
			}
		});

		//listen for route changes
		this.listenForRoutes();

		//off we go
		ready.then(() => this.loadComponent(this.masterComponent, this.container, this.data+'' == '[object Object]' ? this.data : {}));

	}
	let proto = window[classId].prototype;

	/* ---
	| LOAD COMPONENT - load a component. Returns a promise, resolved when the component has fully rendered (including descendant components). 
	| Loading a component may, practically, mean one of several things:
	|	- Initial load of a component
	|	- Re-render of a component e.g. when calling comp.render() (or when a parent or ancestor calls comp.render())
	|	- Reversion to cache - when a child component should be reinstated after reprocessing of a parent conditional e.g. after a route change.
	|	  Example: Default route says child comp should be rendered; route changes to Route2, which says it shouldn't. User navigates back to
	|	  default route and comp gets reinstated. Can be from cache, rather than fresh re-render, if route definition lists component name
	|	  in its @cache property. For this to happen, the child component must set a this.cacheable property in its JS.
	| Args:
	|	@component (str)		- the string name of the component (corresponding to a file it lives in ::compsPath)
	|	@insertion (str)		- an insertion instruction - for master component, this is a DOM reference to the app container; for child
	|							  components, it's the name of the component (a placeholder in the DOM with the component name as class is
	|							  is swapped out for the rendered component)
	|	@props (obj)			- an object of props data to expose to the component, if child component
	|	@isReRender (str)		- denotes is re-render of component, not initial render - the component instance ID
	|	@repSel (str)			- if is child component and was output by parent repeater, the repeater selector
	--- */

	proto.loadComponent = async function(name, insertion, props = {}, isReRender, parentCompObj, fromRepSel, template) {

		return new Promise(async res => {

			//await new Promise(res => setTimeout(res, 1000)); //<-- uncomment to check chronology

			//get component content, from file or cache - if construc.compsFile, must be declared in central components file
			let fp = this.compsPath+'/'+name.toLowerCase()+'.html'+(!this.noCacheCompFiles ? '' : '?r='+Math.round(Math.random() * 10000));
			const content = this[symbols.compFilesCache][name] || (!this.compsFile ? await fetch(fp).then(r => r.ok ? r.text() : null) : null);
			fp = fp.replace(/\?.+$/, '');
			if (content === null) {
				let err = 'Could not load component "'+name+'"'+(parentCompObj ? ' from component "'+parentCompObj.name+'"' : '')+' - ';
				err += !window[classId].compsContentHook && this.compsFile ?
					'check filepath at '+fp :
					'no such component definition found';
				return this.error(err+'.');
			} else if (!content)
				return this.error(fp+' is empty!');
			this[symbols.compFilesCache][name] = content;
			this.components[name] = this.components[name] || [];

			//component details
			name = name.toLowerCase();
			const isMaster = typeof insertion == 'object' || name == this.masterComponent,
				compInstanceId = isReRender != undefined ? isReRender : this.components[name].length;

			//if is reinstatement from reprocessing conditionals (e.g. from route change), grab the cached DOM content, nothing to do beyond here
			if (isReRender === undefined && this[symbols.compDOMsCache][name+'/'+compInstanceId])
				return this.reinstateCompFromCache(name, compInstanceId, res);

			//build component object
			const comp = this.components[name][compInstanceId] = this.buildCompAPI(name, compInstanceId, props, isReRender, parentCompObj, template);

			//re-render? Clear descendant components ahead of them being remade, and clear previously-bound events bindings so not duplicated
			if (isReRender !== undefined) {
				this.clearChildComps(comp);
				for (let evt in this[symbols.events])
					this[symbols.events][evt][name+'/'+compInstanceId] && delete this[symbols.events][evt][name+'/'+compInstanceId];
			}
			
			//extract parts and derive an object with @js, @css and @html parts - only @html is mandatory
			let parts = Object.fromEntries(['css', 'html', 'js'].map(part => [[part], (() => {
					switch (part) {
						case 'css': return content.match(/<style>([\s\S]+?)<\/style>/i);
						case 'html': return content.match(/(?!<style>)<([a-z][a-z\d]*)[^>]*>[\s\S]*<\/\1>/i);
						case 'js': return content.match(/<script>([\s\S]*)<\/script>/);
					}				
				})()])),
				err;
			if (err = checkCompContent(parts, name)) return this.error(err);
			parts.html = parts.html[0];

			//output CSS, where applicable
			parts.css && this.buildCompCSS(name, parts.css[1]);

			//treat HTML
			parts.html = this.treatCompHTML(comp, parts.html, props);

			//render as HTML - initially into temporary element - which element depends on the component's container tag
			comp.DOM = document.createElement(idealParentTag(parts.html));
			comp.DOM.innerHTML = parts.html;
			comp.DOM = comp.DOM.children[0];
			comp.DOM._template = template;
			fromRepSel && comp.DOM.setAttribute(repElAttr, fromRepSel);

			//make DOM elements identifiable as components via symbol
			comp.DOM[window[classId].component = symbols.component] = comp;

			//now render into DOM...

			//...re-render of child component
			if (isReRender !== undefined && name != this.masterComponent) {
				let placeholder = this.container.querySelector('['+compRenderedAttr+'="'+name+'"]['+compRenderedInstanceAttr+'="'+compInstanceId+'"]');
				placeholder.parentNode.replaceChild(comp.DOM, placeholder);

			//...initial render of child component
			} else if (typeof insertion == 'string' && insertion != this.masterComponent) {
				let placeholder = this.container.querySelector('['+compPreRenderAttr+'='+insertion.toLowerCase()+']');
				placeholder.parentNode.replaceChild(comp.DOM, placeholder);

			//...re/render of master component
			} else {
				this.container.innerHTML = '';
				this.container.appendChild(comp.DOM);
			}

			//treat and inject component JS - JS acts on fragment, before render into actual DOM
			!this[symbols.compJsFuncs][name] && this.buildCompJS(parts.js ? parts.js[1] : null, comp);
			this[symbols.compJsFuncs][name+'/'+compInstanceId](this);

			//rendered (minus descendant components) - fire event - also fire route changed event for starting route. Any component listening in on route changed
			//should be notified of starting route, but its JS runs after starting route established, hence fire manually here.
			this.fireEvent(comp, 'rendered');
			this.fireEvent(comp, 'routeChanged');
			const compAlias = comp;
			
			//render child components
			await this.renderChildComps(comp);

			//cache the component's DOM content where appl. - we may revert to this if it's ever removed by a route change and later reinstated
			if (this.reinsCaching === true || (this.reinsCaching instanceof Array && this.reinsCaching.includes(name)))
				this[symbols.compDOMsCache][name+'/'+compInstanceId] = comp.DOM;

			//rendered (inc descendant components)
			this.fireEvent(compAlias, 'fullyRendered');
			this.fullyRenderedTracker[name+'/'+compInstanceId] = 1;

			res();

		});

	}

	/* ---
	| COMPONENT CSS - output component CSS, if haven't already (for component of same name but different instance). Args:
	|	@compName (str)	- obv.
	|	@css (str)		- the component CSS, if any
	--- */

	proto.buildCompCSS = function(compName, css) {

		//prep - skip if already done CSS for this component
		if (!css || this[symbols.doneCssForCompNames].includes(compName)) return;
		this[symbols.doneCssForCompNames].push(compName);

		//...prep sheet
		const sheet = document.createElement('style'),
			compRef = '[data-'+frameworkAlias+'-comp="'+compName+'"]';
		sheet.setAttribute('data-'+frameworkAlias+'-comp', compName);
		document.head.appendChild(sheet);
		sheet.innerHTML = css.trim();

		//...scope rules to this component only
		let rules = sheet.sheet.cssRules,
			newRules = [];
		[...rules].forEach(rule => {
			let sels = rule.selectorText.split(/,\s*/).map(sel => {
				let pseudo = sel.match(regex.pseudo);
				pseudo = !pseudo ? '' : pseudo[0];
				return [
					sel.replace(regex.pseudo, '').replace(/^\S+/, $0 => $0+compRef)+pseudo,
					sel.replace(/^\S+/, $0 => compRef+' '+$0)
				]
			}).flat();
			newRules.push({sel: sels.join(', '), styles: rule.style.cssText});
		});

		//...output
		sheet.innerHTML = newRules.map(rule => rule.sel+' { '+rule.styles+' }').join('\n');

	}

	/* ---
	| COMPONENT JS - create and return a function for a component's user JS, bound to the component context. Args:
	|	@code (str)		- the component JS
	|	@compObj (obj)	- the component object.
	--- */

	proto.buildCompJS = function(code, compObj) {
		const func = new (Object.getPrototypeOf(async function(){}).constructor)('app', `
			${code}
			app.processReps(this);
			app.processConds(this);
			app.processAttrs(this);
		`).bind(compObj);
		func.compObj = compObj;
		this[symbols.compJsFuncs][compObj.name+'/'+compObj.instance] = func;
		return func;
	}

	/* ---
	| REPEATERS - re/process repeaters i.e. elements in the template that should be repeated and populated based on an array of data. Args:
	|	@comp (obj)			- the component object
	|	@isProcess (bool)	- if is later reprocess
	|	@sel (str)			- reprocessing only - an optional selector to reprocess or, if omitted, all repeaters are reprocessed
	--- */

	proto.processReps = function(comp, isReprocess, sel) {

		if (!comp.repeaters) return;

		//establish repeaters - all, or specific
		const repeaters = !sel ? comp.repeaters : {[sel]: comp.repeaters[sel]};

		//iterate over repeaters...
		for (let selector in repeaters) {

			if (!this.validateSel(selector, 'reps', comp.name)) continue;

			//...ascertain selector - if targets child component, convert to target its valid HTML placeholder before it's rendered
			let origSelector = selector,
				childCompName;
			selector = selector.replace(regex.repOrCondChildCompSel, (match, childCompTag) => {
				childCompName = childCompTag.toLowerCase();
				return '*['+compPreRenderAttr+'="'+childCompTag.toLowerCase()+'"]';
			});

			//...establish el (singular) targeted by selector
			let tmpltEl;
			if (!isReprocess) {
				tmpltEl = comp.DOM.querySelectorAll(selector);
				if (tmpltEl.length > 1)
					return this.error('Repeater selector "'+origSelector+'" targets more than 1 element in component "'+comp.name+'"');
				if (!tmpltEl.length) return;
				const com = comp[symbols.repeaterOrigNodes][origSelector] = document.createComment(tmpltEl[0].outerHTML);
				tmpltEl[0].before(com);
				tmpltEl[0].parentNode.removeChild(tmpltEl[0]);
				tmpltEl = com;
			} else
				tmpltEl = comp[symbols.repeaterOrigNodes][origSelector];

			//if reprocess - delete any previous repeater els for this selector
			if (isReprocess) {
				let removeChildComps = [];
				comp.DOM.querySelectorAll('['+repElAttr+'="'+encodeURIComponent(selector)+'"]').forEach(el => {
					el[symbols.component] && removeChildComps.push(el[symbols.component]);
					el.parentNode.removeChild(el);
				});
				removeChildComps.length && this.clearChildComps(comp, null, removeChildComps);
			}

			//...check iteration data - if number, we just want the node, as is, repeated N times
			let repData = comp.repeaters[origSelector];
			if (typeof repData == 'number')
				repData = Array.from({length: comp.repeaters[origSelector]}).fill({});
			if (typeof repData == 'function')
				repData = repData();
			if (!(repData instanceof Array))
				repData = [];

			//...process
			repData.forEach((obj, i) => {
				const tmplt = comp[symbols.repeaterOrigNodes][origSelector].nodeValue,
					newHtml = this.parseVars(tmplt, obj, 'reps', comp, i),
					frag = document.createElement(idealParentTag(newHtml));
				frag.innerHTML = newHtml;
				frag.children[0].setAttribute(repSelAttr, encodeURIComponent(selector));
				frag.children[0][window[classId].repData = symbols.repData] = obj;
				tmpltEl.before(frag.children[0]);
			});
		}

		//if reprocess, re-render child any components that just became available
		if (isReprocess) this.renderChildComps(comp);

	}

	/* ---
	| CONDITIONALS - re/process conditionals for a component - either when it is re/rendered, or later when calling ::reprocessConds(). Args:
	|	@comp (obj) 		- as with ::processReps()
	|	@isReprocess (bool)	- " " "
	|	@sel (str)			- " " "
	|	@flushCache (bool)	- reprocessing only - whether to read live from component DOM rather than cached elements
	|	@force (bool)		- if element already showing, and reprocess decides it should still show, it's rerendered (normally left unchanged)
	|						  This means its JS can run again and be fed fresh props.
	--- */

	proto.processConds = function(comp, isReprocess, sel, force) {

		if (!comp.conditionals) return;

		//establish conditionals - all, or specific
		const conditionals = !sel ? comp.conditionals : {[sel]: comp.conditionals[sel]};

		//iterate over conditionals...
		for (let selector in conditionals) {

			if (!this.validateSel(selector, 'conds', comp.name)) continue;

			//...ascertain selector - as with ::processReps()
			let origSelector = selector;
			selector = selector.replace(regex.repOrCondChildCompSel, (match, childCompTag) =>
				'*['+compPreRenderAttr+'="'+childCompTag.toLowerCase()+'"]'
			);
			if (isReprocess) selector += ', '+selector.replace(new RegExp(compPreRenderAttr, 'g'), compRenderedAttr);

			//...establish el(s) targeted by selector - if is reprocess, and element initially failed conditional check,
			//it'll exist in DOM as a commented-out tag. Temporarily render it, so it can be found by selector
			let temporarilyRendered = [];
			if (isReprocess) {
				let comments = [comp.DOM, ...comp.DOM.querySelectorAll('*')].reduce((acc, node) => {
					return [...acc, ...[...node.childNodes].filter(node => node.nodeType === 8 && new RegExp('^'+noRenderElIdentifier).test(node.nodeValue))];
				}, []);
				comments.forEach(comment => {
					const content = comment.nodeValue.replace(noRenderElIdentifier, ''),
						frag = document.createElement(idealParentTag(content));
					frag.innerHTML = this.parseVars(content, comp.data, 'reps', comp);
					temporarilyRendered.push(frag.children[0]);
					frag.children[0]._template = content;
					comment.replaceWith(frag.children[0]);
				});
			}
			let els = comp.DOM.querySelectorAll(selector);
			temporarilyRendered.filter(el => ![...els].includes(el)).forEach(el => {
				let com = document.createComment(noRenderElIdentifier+el._template);
				el.replaceWith(com);
			});

			//...process
			els.forEach(condEl => {
				if (!condEl) return;
				if (!condEl._template) condEl._template = condEl.outerHTML;
				let decider = conditionals[origSelector];
				if (!decider || (typeof decider == 'function' && !decider(condEl)) || force) {
					if (condEl.matches('['+compRenderedAttr+']')) {
						const compName = condEl.getAttribute(compRenderedAttr);
						this.clearChildComps(this.components[compName]);
						delete this.components[compName][condEl.getAttribute(compRenderedInstanceAttr)];
						this.components[compName] = this.components[compName].filter(c => c);
					}
					let com = document.createComment(noRenderElIdentifier+condEl._template);
					condEl.replaceWith(com);
					if (force) this.processConds(comp, isReprocess, sel);
				}

			});

		}

		//if reprocess, re-render child any components that just became available
		if (isReprocess) this.renderChildComps(comp);

	}

	/* ---
	| LIVE ATTRIBUTES - as with ::processConds(), but for live attributes. Args:
	|	@comp (obj)			- the component object
	|	@isReprocess (bool)	- as with ::processConds()
	|	@attr (str)			- if reprocess only - the name of attr(s) to reprocess - so not the whole object key, just the part after "/"
	|	@flushCache (bool)	- as with ::processConds()
	--- */

	proto.processAttrs = function(comp, isProcess, attr, flushCache) {

		if (!comp.attrs) return;
		if (!comp.attrs[symbols.liveAttrsCache]) Object.defineProperty(comp.attrs, symbols.liveAttrsCache, {value: {}});

		//establish conditionals - all, or specific
		const attrs = !attr ? comp.attrs : (() => {
			let ret = {};
			for (let sel in comp.attrs) if (new RegExp('@'+attr+'$').test(sel)) ret[sel] = comp.attrs[sel];
			return ret;
		})();

		//iterate over instructions...
		for (let sel in attrs) {

			//...validate
			if (!regex.liveAttr.test(sel))
				return this.error('live attribute "'+sel+'" is not in format "selector/@attr" in component "'+comp.name+'"');
			if (!['function', 'string', 'number'].includes(typeof attrs[sel]))
				return this.error('value for live attribute "'+sel+'" is not a function, string or number in component "'+comp.name+'"');

			//...split into selector vs. attribute name
			let spl = sel.split(/\/@/), els;

			//get elements - live or from cache
			if (!isProcess || flushCache || !comp.attrs[symbols.liveAttrsCache][sel]) {
				els = [...comp.DOM.querySelectorAll(spl[0])];
				if (comp.DOM.matches(spl[0])) els.push(comp.DOM);
				comp.attrs[symbols.liveAttrsCache][sel] = els; //<-- we have one copy of Aprikos.js where this line is in the else, not the if. ??
			} else
				els = comp.attrs[symbols.liveAttrsCache][sel];

			//effect
			els.forEach(el => {
				el.setAttribute(spl[1], typeof attrs[sel] == 'function' ? attrs[sel](el) : attrs[sel]);
			});

		}
	}

	/* ---
	| BUILD COMPONENT API - build a component's API - an object of its data, info, methods etc. We use Object.defineProperty() for immutability.
	| Args: (all equivalent from ::loadComponent()).
	--- */

	proto.buildCompAPI = function(name, compInstanceId, props, isReRender, parentCompObj, childCompTmplt) {

		//prep - logo props as @data
		const comp = {data: props},
			outerThis = this,
			prevBuild = isReRender !== undefined ? this.components[name][compInstanceId] : null;

		//proxy data
		comp.data = new Proxy(comp.data, this.getProxyConfig(comp));

		//log details about this comp
		const about = {
			name: name,
			instance: compInstanceId,
			renderTime: new Date(),
			reRendered: isReRender !== undefined,
			parent: parentCompObj,
			app: this
		};
		for (let detail in about) Object.defineProperty(comp, detail, {value: about[detail]});

		//...states: there's two state caches for a component (used when reinstating a component previously allowed, then disallowed, by a
		//parent conditional, provided construc.reinsCaching is true or an array including the component name). There's an indexed states cache,
		//which works like an undo/redo tree, and a persistent states tree, with named states that can't be lost in the way that indexed
		//states can (e.g. if you go to state 1, then go back to 0, then make a new state - a new state 1 is created, and the old is lost)
		comp.activeState = !prevBuild ? 0 : prevBuild.activeState;
		comp[symbols.activeIndexedState] = !prevBuild ? 0 : prevBuild[symbols.activeIndexedState];

		//some private, symbol-based stuff
		comp[symbols.repeaterOrigNodes] = {};
		comp[symbols.statesCache] = prevBuild ? prevBuild[symbols.statesCache] : [new Proxy(copyObj(comp.data), this.getProxyConfig(comp))];
		comp[symbols.persistentStatesCache] = prevBuild ? prevBuild[symbols.persistentStatesCache] : {};

		//add in live collections (via getters) for child/sibling components
		Object.defineProperties(comp, {
			children: {
				get: () => Object.values(outerThis.components).map(comps =>
					comps.filter(comp => comp.parent && comp.parent.name+comp.parent.instance === name+compInstanceId)
				).flat()
			},
			siblings: {
				get: () => Object.values(outerThis.components).map(comps =>
					comps.filter(comp => comp.name+comp.instance !== name+compInstanceId && comp.parent && comp.parent === parentCompObj)
				).flat()
			}
		});

		//define methods...
		const methods = {

			//...render - this may happen before the initial render is complete, in which case log it in a fully-rendered callback to run later
			//Component's current data is merged with updated props values from parent (unless comp is master)
			render: () => {
				if (comp.name != outerThis.masterComponent) {
					let frag = document.createElement('div');
					frag.innerHTML = outerThis.parseVars(comp.DOM._template, comp.parent.data, 'init', comp);
					let newProps = buildProps(frag.children[0]);
					props = Object.assign(props, newProps);
				}
				const func = () => this.loadComponent(name, name, props, compInstanceId, parentCompObj);
				outerThis.fullyRenderedTracker[name+'/'+compInstanceId] ? func() : comp.on('fullyRendered', func);
			},

			//...on {event} (see constr[symbols.events] for valid events) 
			on: on.bind(comp),

			//...reprocess repeaters/conditionals/live attrs
			reprocessReps: sel => this.processReps(comp, 1, sel),
			reprocessConds: (sel, force) => this.processConds(comp, 1, sel, force),
			reprocessAttrs: (sel, flushCache) => this.processAttrs(comp, 1, sel, flushCache),

			//...message (another component)
			message: (xpath, data) => this.compMessage(comp, xpath.toLowerCase(), data),

			//...activate route (or change data of current route) - @data is a segmented list or a JSON string / JS object denoting to the route
			go: data => {
				if (!['string', 'object'].includes(typeof data)) return this.error('route change - passed data must be string or object');
				location.hash = '#/'+(typeof data == 'string' ? data : JSON.stringify(data));
			},

			//...new state - @persist is an optional persistent state name (otherwise indexed state assumed)
			newState: persist => {
				const data = new Proxy(copyObj(comp.data), outerThis.getProxyConfig(comp));
				if (!persist) {
					comp[symbols.activeIndexedState]++;
					comp.activeState = comp[symbols.activeIndexedState];
					comp[symbols.statesCache][comp.activeState] = data;
					comp[symbols.statesCache] = comp[symbols.statesCache].slice(0, comp.activeState + 1);
				} else {
					comp.activeState = persist;
					comp[symbols.persistentStatesCache][persist] = data;
				}
				return persist || comp.activeState;
			},

			//...change state - @which is an index or persistent state name. comp.activeState is set to @which (if a persistent state,
			//an internal tracker, comp[symbols.activeIndexedState], remembers the indexed position (any future 'next'/'prev' will be from
			//that index)....
			changeState: which => {

				let valid = false;

				//...index (int)
				if (typeof which == 'number') {
					if (comp[symbols.statesCache][which]) {
						comp.data = comp[symbols.statesCache][which];
						valid = 1;
						comp.activeState = comp[symbols.activeIndexedState] = which;
					} else {
						this.error('no such state for component '+comp.name+'/'+comp.instance+', "'+which+'"');
						return false;
					}

				//...index ('next'/'prev' alias)
				} else if (['next', 'prev'].includes(which)) {
					which = comp[symbols.activeIndexedState] + (which == 'next' ? 1 : -1);
					if (comp[symbols.statesCache][which]) {
						comp.data = comp[symbols.statesCache][which];
						valid = 1;
						comp.activeState = comp[symbols.activeIndexedState] = which;
					}
				}

				//...persistent state - @activeState will remain where it is - that's for the indexed states cache only
				else if (comp[symbols.persistentStatesCache][which]) {
					valid = 1;
					comp.data = comp[symbols.persistentStatesCache][which];
					comp.activeState = which;
				}

				//valid request - reprocess comp's attrs/conds/reps
				if (valid) {
					!this.manualConds && comp.rc();
					!this.manualAttrs & comp.ra();

				//no such state
				} else
					return false;

			}

		};

		//...method shortcuts
		methods.rc = methods.reprocessConds;
		methods.ra = methods.reprocessAttrs;
		methods.rr = methods.reprocessReps;
		for (let method in methods) Object.defineProperty(comp, method, {value: methods[method]});

		return comp;
	}

	/* ---
	| COMPONENT HTML - treat component HTML - swap out vars etc. Args:
	|	@compObj (obj)	- the component object
	|	@html (str)		- the component's HTML template
	|	@props (opj)	- the component's props
	--- */

	proto.treatCompHTML = function(compObj, html, props) {

		//shoehorn in component name and instance IDs...
		html = html.replace(/(<[^>]+)>/, ($0, $1) =>
			$1+' '+compRenderedAttr+'="'+compObj.name+'" '+compRenderedInstanceAttr+'="'+compObj.instance+'">'
		);

		//...swap out child components for placeholders - parse HTML as shadow XML DOM to help with establishing child comps' parent tags
		//if we can't find one, means the child component is probably commented out, but still gets picked up by REGEX pattern, obvs.
		let xml = new DOMParser().parseFromString(html, 'text/xml');
		if (xml.documentElement.tagName == 'parsererror') return this.error('Invalid markup on HTML template for component "'+compObj.name+'"');
		html = html.replace(regex.childComps, ($0, compName, props) => {
			let correspondingXMLNode = xml.querySelector(compName);
			if (!correspondingXMLNode) return '';
			let childCompTmpTag = childCompTmpTagName(correspondingXMLNode.parentNode.tagName);
			return '<'+childCompTmpTag+' '+props+' '+compPreRenderAttr+'='+compName.toLowerCase()+'></'+childCompTmpTag+'>';
		});

		//convert var placeholders to HTML comment form, so they don't render until (and unless)parsed
		html = varsToCommentVars(html);

		//do initial parsing of vars (we'll do another sweep later, for repeaters)
		html = this.parseVars(html, props, 'init', compObj);

		//repoint inline event handlers to run in context of component (trigger element is passed in as $element)
		html = html.replace(/( on[^=]+=(['"]))([\s\S]+?)\2/g, ($0, $1, $2, code) => {
			return $1+'(function($element) { '+code+' }).call('+classId+'.apps['+this.appId+'].components.'+compObj.name+'['+compObj.instance+'], this)'+$2;
		});

		return html;

	}

	/* ---
	| REVERT TO CACHE - render a child component from cache, i.e. reinstate its previously-cached DOM. This happens when a child component
	| was previously allowed by a parent conditional, then disallowed, then later re-allowed, e.g. following route changes. Args:
	|	@name (str)			- the component name
	|	@instance (str)		- the component instance ID
	|	@promiseRes (obj)	- the promise resolver callback from the ::loadComponent() promise
	--- */

	proto.reinstateCompFromCache = function(name, instance, promiseRes) {

		//grab old component object - it's no longer in this.components, since the component was unrendered when it previously failed a
		//conditional, but we have a reference to it on the component's JS function
		const comp = this[symbols.compJsFuncs][name+'/'+instance].compObj;

		//reinstate it in this.components
		this.components[name][instance] = comp;

		//set its DOM to the cached DOM from when it was last around
		comp.DOM = this[symbols.compDOMsCache][name+'/'+instance];

		//put into DOM
		const placeholder = this.container.querySelector('['+compPreRenderAttr+'='+name.toLowerCase()+']');
		placeholder.parentNode.replaceChild(comp.DOM, placeholder);

		//fire events (for self and deeper child components). Rendered and fullyRendered events fire at the same time here, as there's no
		//child components to render - entire component tree, including any child components, are from cache, not async re-rendering
		[comp.DOM, ...comp.DOM.querySelectorAll('*['+compRenderedAttr+']')].forEach(compEl => {
			this.fireEvent(compEl[symbols.component], 'rendered');
			this.fireEvent(compEl[symbols.component], 'fullyRendered');
		});

		//resolve ::loadComponent()'s promise
		promiseRes();
	}

	/* ---
	| PARSE VARS - handle variable placeholder replacements e.g. for props, repeaters. Placeholders should be in format {{var}}. It's key
	| that any unparsed args are left as placeholders so later processes can pick them up. Args:
	|	@str (str)						- the string (i.e. of HTML) to parse within
	|	@pool (*)						- the pool of data - normally an object, but may be a primitive (where the parent houser is an array of
	|									  values not objects)
	|	@stage (str)					- the parsing stage - either initial ('init') or, later, when parsing repeaters ('reps')
	|	@comp (obj)						- the component object we're parsing for
	--- */

	proto.parseVars = function(str, pool, stage, comp, repIteration) {

		let val;
		return str.replace(regex.varsAsComments, (match, varName, filterMethod) => {
			
			//run through a filter method?
			let fmFunc = filterMethod && this.methods && this.methods[filterMethod];

			//no data for swaps - retain placeholder
			if (!pool) return match;

			//is basic property reference...
			if (!/[\.\[]/.test(varName)) {
				
				//...is route data reference
				if (regex.routeDataVars.test(varName))
					return this.activeRoute !== undefined ? (fmFunc || (val => val))(this.routeData[varName.replace(regex.routeDataVars, '')], comp) : '';

				//...if initial sweep and @pool doesn't have its own @varName, leave placeholder in place for reps sweep
				if (stage == 'init' && !pool.hasOwnProperty(varName)) return match;

				//...establish val, possibly via filter method - some special, predefined vars exist for repeaters
				if (varName[0] != '$')
					val = pool[varName];
				else if (stage == 'init')
					val = varName;
				else
					switch (varName) {
						case '$value': val = pool; break;
						case '$index': val = repIteration; break;
						default: val = match; break;	
					}
				if (val === undefined) return match;
				if (fmFunc) val = fmFunc(val, comp);

				//...if ended up with a primitive, output
				if (!isComplex(val)) return val;

				//...else if complex, log reference
				complexObjs.push(val);
				return '['+(typeof val == 'object' ? 'object Object' : 'function')+':'+(complexObjs.length-1)+']';

			//is complex expression going deeper into @obj - parse...
			} else {

				try {
					let special = varName.match(/^\$(\w+)([\s\S]+)/);
					if (!special)
						val = eval('pool.'+varName);
					else if (stage == 'init')
						return match;
					else
						switch (special[1]) {
							case 'value': val = eval('pool'+special[2]); break;
						}
					if (val === undefined) return match;
					if (!isComplex(val)) return !fmFunc ? val : fmFunc(val, comp);
					complexObjs.push(!fmFunc ? val : fmFunc(val, comp));
					return objToStr();
				} catch(e) {

					//...couldn't parse it - retain placeholder
					return match;
				}
			}
		});
	}

	/* ---
	| REMOVE CHILD COMPS - when rendering a parent component, remove old references to its child components, recursively down the generations.
	| Otherwise, when we re-render a parent component, the replaced child components would persist in the app-wide components container. Args:
	|	@parentCompObj (obj) 	- the parent component's object
	|	@recursion (bool)		- if is func calling itself, for deeper levels
	|	@childComps (arr)		- rather than beginning from all child components of @parentCompObj, just those specified in this array
	--- */

	proto.clearChildComps = function(parentComp, recursion, childComps) {

		//iterate over components...
		for (let compName in this.components) {
			let removed = 0;
			this.components[compName].forEach((comp, id) => {

				//...check applicable...
				if (
					comp.parent &&
					comp.parent.name === parentComp.name &&
					comp.parent.instance === parentComp.instance &&
					(!childComps || childComps.includes(comp))
				) {

					//...delete comp object
					this.components[compName][id] && this.clearChildComps(this.components[compName][id], 1);
					delete this.components[compName][id - removed];
					removed++;

					//...and any event refs to it
					for (let evt in this[symbols.events])
						for (let compId in this[symbols.events][evt])
							delete this[symbols.events][evt][compId];

				}

				//...filter out just-deleted comps from objects container
				this.components[compName] = this.components[compName].filter(c => c);

			});
		}
	}

	/* ---
	| RENDER CHILD COMPS - render child components within a given component. By this stage they exist as temporary (but valid HTML) placeholders,
	| not their original <MyComp ... /> form. Args:
	|	@comp (obj)	- a component object to render within.
	--- */

	proto.renderChildComps = async function(comp) {

		//iterate over child comp refs...
		for (let node of [...comp.DOM.querySelectorAll('['+compPreRenderAttr+']')]) {

			//...prep props
			const compName = node.getAttribute(compPreRenderAttr),
				template = node._template || node.outerHTML,
				props = buildProps(node);

			//render
			await this.loadComponent(compName, compName, props, undefined, comp, node.getAttribute(repElAttr), template);
		};
	}

	/* ---
	| ATTACH EVENT - listen for a given (predefined, not DOM) event relating to a component. Proxied to comp.on() (and so called in the context
	| of the component object). Args:
	|	@event (str)		- the event to listen on - one of those declared in ::events
	|	@cb (func)			- the callback
	--- */

	function on(evt, cb) {

		//prep - locate app: this or, if being called from/in context of component, this.app
		const errTmplt = 'Missing/invalid {what} passed to on() from component "'+this.name+'"';
		if (!Object.keys(this.app[symbols.events]).includes(evt)) return this.app.error(errTmplt.replace('{what}', 'event type "'+(evt || '')+'"'));
		if (typeof cb != 'function') return this.app.error(errTmplt.replace('{what}', 'callback function (for event type "'+evt+'")'));

		//save to events cache
		let key = this.name+'/'+this.instance;
		if (!this.app[symbols.events][evt][key]) this.app[symbols.events][evt][key] = [];
		this.app[symbols.events][evt][key].push(cb);

	}

	/* ---
	| FIRE EVENT - listen for component event firing. Callbacks are passed the event name and called in the context of the component. Args:
	|	@comp (obj; null) 	- the component object of the causal component, if there was one (some events fire at app-level, e.g. route change,
	| 						  but we always bind from components, so in this case iterate over components to see who's listening.)
	|	@evt (str)			- the event type (from ::events)
	|	@dataN (?)			- one or more params to forward to the callback - basically, all args but @comp and @evt get forwarded
	--- */

	proto.fireEvent = function(comp, evt) {
		const comps = [comp || Object.values(this.components).flat()].flat();
		comps.forEach(comp => {
			const key = comp.name+'/'+comp.instance;
			this[symbols.events][evt][key] && this[symbols.events][evt][key].forEach(cb => cb.apply(comp, [...arguments].slice(2)));
		});
	}

	/* ---
	| ROUTES - VALIDATE - from constructor, validate @routes map, if set. Returns error string if any, else undefined if OK/no routes.
	--- */

	proto.validateRoutes = function() {
		if (!this.routes) return;
		if (this.routes.toString() != '[object Object]')
			return '@routes, if specified, must be an object of route IDs to config objects '+this.routes.toString();
		for (let routeId in this.routes) {
			const route = this.routes[routeId];
			if (!routeTypes.includes(route.type))
				return 'missing or invalid @type property for route "'+routeId+'" - should be "'+routeTypes.join('" or "')+'"';
			if (route.type == 'seg' && !(route.ptn instanceof RegExp))
				return 'missing or invalid @ptn (pattern property for route "'+routeId+'" - should be a RegExp pattern';
		}
	}

	/* ---
	| ROUTES - LISTEN - listen for route changes - run through any routes logged on app and activate any that match, gathering up passed
	| data. There are two types of route:
	|	- SEGMENT-based (slash-delimited). These have a REGEX pattern to identify them and can have an optional @parts array of property
	|	  names to map the segments to in the route data that gets logged (note: this begins from the second segment, since the first
	|	  will always be used to identify the route). Example: If the route definition is "foo: {type: 'seg', ptn: /^foo/, parts: [a, b]}"
	|	  and the URL is ...#/foo/one/two, the resultant route data will be {a: 'one', b: 'two'}.
	|	- JSON-based. These are literally JSON passed in the hash. The parsed JSON must contain a @route property identifying the route,
	|	  and any other data in the object are used as route data.
	--- */

	proto.listenForRoutes = function() {
		let checkRoutes;
		addEventListener('hashchange', checkRoutes = evt => {

			//prep
			if (!this.routes) return;
			const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
			let foundRoute;

			//iterate over routes...
			for (let routeId in this.routes) {
				const route = this.routes[routeId];

				//...validate type
				if (!['seg', 'json'].includes(route.type)) {
					this.error('Route "'+routeId+'" does not contain a valid route @type property - must be "seg" (slash-delimited) or "json"');
					continue;
				}

				//...segment-based route...
				if (route.type == 'seg') {

					//...validate pattern
					if (!route.ptn || !(route.ptn instanceof RegExp)) {
						this.error('Route "'+routeId+'" does not have a @ptn (pattern) property or is not a RegExp pattern');
						continue;
					}

					const segs = hash.split('/').filter(seg => seg)

					//...matches pattern? Gather up data if so
					if (route.ptn.test(hash)) {
						foundRoute = 1;
						const data = route.parts ?
							route.parts.reduce((acc, val, i) => {
								acc[val] = segs[i+1];
								return acc;
							}, {}) :
							segs.slice(1).reduce((acc, val, i) => {
								acc[i] = val;
								return acc;
							}, {});
						this.activeRoute = routeId;
						this.routeData = data;
					}

				//...JSON-based route
				} else {
					try {
						const data = JSON.parse(hash);
						if (!data.route || data.route != routeId) continue;
						foundRoute = 1;
						delete data.route;
						this.activeRoute = routeId;
						this.routeData = data;
					} catch(e) {}
				}
			}

			//if failed to find route, assume it's a reversion to default route
			if (!foundRoute) this.activeRoute = undefined;

			//notify any listening components
			this.fireEvent(null, 'routeChanged');

		});
		checkRoutes();
	}

	/* ---
	| COMPONENT MESSAGE - send a message from one component to another. Pass to callback [0] the calling component; [1] @msg. Args:
	|	@from (obj)	- the object of the sender component
	|	@to (str)	- an XPath targeting the component(s) to send the message to (based on the XML DOM returned by ::getCompsDOM())
	|	@msg (?)	- the message - can be any data type
	--- */

	proto.compMessage = function(from, to, msg) {

		//prep
		const dom = this.getCompsDOM(),
			resType = XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
			fromNode = dom.evaluate('//'+from.name+'[@instance="'+from.instance+'"]', dom, null, resType).snapshotItem(0);

		//attempt to parse XPath and find target component(s) - try-catch is because XPath may be invalid	
		try {
			const toNodesResult = dom.evaluate(to, fromNode, null, resType);
			for (let i=0; i<toNodesResult.snapshotLength; i++) {
				let node = toNodesResult.snapshotItem(i);
				this.fireEvent(this.components[node.tagName.toLowerCase()][node.getAttribute('instance')], 'message', from, msg);
			}
		} catch(e) {
			this.error('message() error - '+e);
		}
	}

	/* ---
	| HIERARCHY - build an XML document representation of the components hierarchy. Returns XML DOM. Args:
	|	@compObj (obj)	- on recursion only; the next component to process.
	--- */

	proto.getCompsDOM = function(compObj) {
		const node = compObj ? compObj.name : this.masterComponent,
			recursion = compObj;
		if (!compObj) compObj = this.components[node][0];
		let str = '<'+node+' instance="'+compObj.instance+'">';
		if (compObj.children.length) str += compObj.children.map(child => this.getCompsDOM(child)).join('');
		str += '</'+node+'>';
		if (recursion) return str;
		else {
			const dom = new DOMParser();
			return dom.parseFromString(str, 'text/xml');
		}
	}

	/* ---
	| PROXY CONFIG - return a config object for a proxy. Args:
	|	@comp (obj)	- the component object
	--- */

	proto.getProxyConfig = function(comp) {
		let outerThis = this;
		return {
			get(obj, prop) { return typeof obj[prop] == 'object' && obj[prop] !== null ? new Proxy(obj[prop], outerThis.getProxyConfig(comp)) : obj[prop]; },
			set(obj, prop, val) {
				obj[prop] = val;
				!outerThis.manualConds && comp.rc();
				!outerThis.manualAttrs && comp.ra();
				return true;
			}
		};
	}

	/* ---
	| LOG - obv. Args:
	|	@item1 (?)		- the item to log.
	|	... (?)			- subsequent, additional items to log.
	--- */

	proto.error = function() {
		let msgs = [classId+' -', ...arguments];
		console.error.apply(null, msgs);
		document.body.dispatchEvent(new CustomEvent(frameworkId+'Error', {detail: msgs}));
	}

	/* ---
	| (UTIL) VALIDATE SELECTOR - validate a conditional or repeater selector to ensure it doesn't try to reach into a child component. Args:
	|	@sel (str)		- the selector
	|	@context (str)	- either 'conds' or 'reps'
	|	@compName (str)	- obv.
	--- */

	proto.validateSel = function(sel, context, compName) {
		const result = !regex.condOrRepSelNoReachIntoChildComp.test(sel);
		if (!result)
			this.error((context == 'conds' ? 'conditional' : 'repeater')+' selectors cannot reach into child components in component "'+compName+'" (selector: "'+sel+'")');
		return result;
	}

	/* ---
	| (UTIL) GET PROPS - build and return a props object for a given child component template. Args:
	|	@node (obj)	- a span node representation of a child component template
	--- */

	function buildProps(node) {
		let props = {};
		[...node.attributes].filter(attr => !/^(_|data-)/.test(attr.name)).forEach(attr => {
			if (!regex.varsAsComments.test(attr.value)) {
				const complex = attr.value.match(regex.complexType);
				props[attr.name] = !complex ? attr.value : complexObjs[complex[1]];
			} else
				props[attr.name] = undefined;
		});
		return props;
	}

	/* ---
	| (UTIL) CHECK COMPONENT CONTENT - check the content of a component. Returns error message on problem, else false if no problem. Args:
	|	@contenet (str) - the component file's content
	|	@compName (str)	- the component's name
	|	@fp (str)		- the filepath to the component file
	--- */

	function checkCompContent(content, compName, fp) {
		const errPart = ' in component "'+compName+'"';
		if (!content.html) return 'Could not find component HTML'+errPart;
		const unquotedAttr = content.html[0].match(regex.unquotedAttr);
		if (unquotedAttr) return 'Attributes in component templates must be quoted - found unquoted attribute @'+unquotedAttr[1]+errPart;
		if (content.html.includes('<'+compName)) return 'Recursion error - components cannot refer to themselves as child components'+errPart;
	}

	/* ---
	| (UTIL) CHILD COMP TAG NAME - establish a pre-render tag name to use for a child component, so it's valid within parent
	|	@parentTagName (str) - the tag name of the parent we need to harmonise with
	--- */

	function childCompTmpTagName(parentTagName) {
		switch (parentTagName) {
			case 'table': return 'thead';
			case 'thead': case 'tbody': return 'tr';
			case 'tr': return 'td';
			case 'ul': case 'ol': return 'li';
			default: return 'span';
		}
	}

	/* ---
	| (UTIL) PARENT TAG NAME - opposite of childCompTmpTagName() - for when we parse a child component to a doc fragment, establish a suitable
	| parent tag to put it in, so the HTML is valid (i.e. if child component tag is <tr>, can't put that in a doc fragment of <div>). Args:
	|	@childCompTmplt (str)	 - the child component HTML template
	--- */

	function idealParentTag(childCompTmplt) {
		let childCompTag = childCompTmplt.match(/^<(\S+)/);
		switch (childCompTag[1]) {
			case 'tr': case 'thead': case 'tbody': return 'table';
			case 'td': return 'tr';
			case 'li': return 'ul';
			default: return 'div';
		}
	}

	/* ---
	| (UTIL) OBJ TO STR - output a temporary reference to a complex object or function (the last one pushed into @complexObjs)
	--- */

	function objToStr() {
		let obj = complexObjs.length-1;
		return '['+(typeof obj == 'object' ? 'object Object' : 'function')+':'+(complexObjs.length-1)+']';
	}

	/* ---
	| (UTIL) IS COMPLEX - is passed item a compex as opposed to primitive? Args:
	|	@item (?)	- the item to check type.
	--- */

	function isComplex(item) { return ['object', 'function'].includes(typeof item); }

	/* ---
	| (UTIL) VAR FORMAT - format braces-based vars i.e. {{foo}} to comment-based vars e.g. <!--aprk-var:foo-->
	--- */

	function varsToCommentVars(str) {
		return str.replace(regex.vars, match => match.replace('{{', '<!--'+varIdentifier).replace('}}', '-->'));
	}

	/* ---
	| (UTIL) - COPY OBJ - generates and returns deep copy of object, retaining references to complex types. Args:
	|	@src (obj)	- the source object.
	--- */

	function copyObj(src) {
		let target = Array.isArray(src) ? [] : {};
		for (let prop in src)
			target[prop] = src[prop] && typeof src[prop] === 'object' ? copyObj(src[prop]) : src[prop];
		return target;
	}

	return window[classId];

})();
