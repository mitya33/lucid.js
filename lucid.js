/* -----------
| LUCID.JS
| @author: Andy Croxall (mitya.uk; github.com/mitya33)
----------- */

'use strict';

window.Lucid = window.Lucid || (() => {

	//general framework prep
	const frameworkId = 'lucid',
		classId = frameworkId[0].toUpperCase()+frameworkId.substr(1),
		complexObjs = [],
		varIdentifier = frameworkId+'-var:',
		noRenderElIdentifier = frameworkId+'-no-render:',
		symbols = {
			component: Symbol(),
			repData: Symbol(),
			fmCache: Symbol()
		},
		routeTypes = ['seg', 'json'],
		startUri = location.pathname,
		compPreRenderAttr = 'data-component-name',
		compRenderedAttr = 'data-'+frameworkId+'-comp',
		compModelAttr = 'data-'+frameworkId[0]+'model',
		compRenderedInstanceAttr = 'data-'+frameworkId+'-instance',
		repElAttr = 'data-'+frameworkId+'-rep-sel',
		repSelAttr = 'data-'+frameworkId+'-rep-sel',
		regex = {
			parentTag: /<([A-Za-z]\w+)[^>]*>[\s\S]+/,
			childCompName: /^[A-Z][A-Za-z\d\-]*$/,
			childCompTags: /<([A-Z][A-Za-z\d\-]*)[^<>]*?>/g,
			repOrCondChildCompSel: /\b([A-Z][A-Za-z\d\-]*)(?!=["\]])\b/g,
			vars: /{{([^}\|]+)(?:\|(\w+)\((1|true)?\))?}}/g,
			complexType: /\[(?:object Object|function):(\d+)\]/,
			compsFileCompMarker: /^<!-- ?COMPONENT (\w+) ?-->$/gm,
			condOrRepSelNoReachIntoChildComp: /[A-Z][A-Za-z\d\-]* +[a-zA-Z]/,
			pseudo: /::?[\w\-]+/,
			routeDataVars: /^\$rd:/,
			dynamicCompJsBody: /(^[^{]+{|}$|^\([^\)]*\) *=> *)/g
		};
		regex.varsAsComments = new RegExp(regex.vars.source.replace('{{', '<!-- ?'+varIdentifier).replace('}}', ' ?-->').replace('^}', '^-'), 'g');

	/* ---
	| CONSTRUCTOR - args:
	|	@params (obj)	- object of params, including:
	|		@container (obj; sel)		- a container for the app, either a reference to an HTML element or a selector string pointing to
	|									  one (dflt: 'body')
	|		@compsPath (str)			- path to location of component files (dflt: '.')
	|		@compsFile (str)			- path to a .html file containing config for all components, rather than each having its own file
	|		@methods (obj)				- object of app-level filter methods that can be used in var placeholders i.e. {{myvar|mymethod()}}. Components can have their
	|									- own, local @methods, too.
	|		@autoReprocess (arr) 		- array of structures that should auto-reprocess as component data written (dflt: ['output', 'attrs'] - 'conds'/'reps' also allowed)
	|		@masterComponent (str)		- the name of the master component (dflt: 'master')
	|		@routes (obj)				- a map of routes data, with keys denoting route IDs and values as objects with route config. See ::listenForRoutes() for more.
	|		@reinsCaching (bool; arr)	- whether child components should be reinstated from cache rather than fresh when they are reinstated by a parent's reprocessed
	|									  conditional - true for all components, or an array of component names
	|		@noCacheCompFiles (bool)	- set true to not cache component files, so they're loaded fresh each time (dflt: false)
	|		@data (obj)					- an object of starting data, i.e. props for the master component
	--- */

	function engine(params) {

		//prep & containers
		engine.apps = engine.apps || [];
		engine.apps.push(this);
		this.appId = engine.apps.length - 1;
		this.compFilesCache = {};
		this.compDOMsCache = {};
		this.compJsFuncs = {};
		this.doneCssForCompNames = [];
		this.components = {};
		this.events = {
			rendered: {},
			fullyRendered: {},
			routeChanged: {},
			routeFetched: {},
			routeFetchError: {},
			message: {}
		};
		this.fullyRenderedTracker = {};

		//merge params with defaults and assign to instance
		Object.assign(this, {
			compsPath: '.',
			masterComponent: 'master',
			container: 'body',
			autoReprocess: ['output', 'attrs'],
			manualAttrs: false,
			methods: {},
			routes: {},
			usePushState: false
		}, params || {});

		//establish/check app container
		if (typeof this.container == 'string') this.container = document.querySelector(params.container);
		if (!(this.container && this.container.tagName)) return this.error('Container is not an element');

		//validate routes
		if (this.validateRoutes()) return this.error(this.validateRoutes());

		//listen for route changes in a@href attrs via "route:" protocol
		this.container.addEventListener('click', evt => {
			if (!evt.target.matches('a[href^="route:"]')) return;
			evt.preventDefault();
			this.components[this.masterComponent][0].go(evt.target.getAttribute('href').replace(/^route:/, ''));
		});

		//handle models (binding with form inputs)
		this.container.addEventListener('input', evt => {
			if (!evt.target.matches('['+compModelAttr+']')) return;
			let bindToDataProp = evt.target.getAttribute(compModelAttr),
				comp = evt.target.closest('['+compRenderedAttr+']');
			if (!comp || !bindToDataProp) return;
			comp[symbols.component].data[bindToDataProp] = !evt.target.matches('[type=checkbox], [type=radio]') ? evt.target.value : evt.target.checked;
		});

		//single components file rather than separate files? Parse and cache. Also handles special scenario of Lucid playground, where components data
		//is read from Lucid.compsContentHook() func.
		const ready = new Promise(res => {
			if (!this.compsFile && typeof window[classId].compsContentHook != 'function') return res();
			if (!engine.compsContentHook) {
				const fp = this.compsPath+'/'+this.compsFile.replace(/\.html$/, '')+'.html';
				fetch(fp)
					.then(r => { if (r.ok) return r.text(); else throw new Error('could not load components from '+fp+' - check path'); })
					.then(content => {
						if (!regex.compsFileCompMarker.test(content))
							throw new Error('components file '+fp+' is not properly formatted - components must be preceded by comment in format <!-- COMPONENT MYCOMPONENTNAME -->');
						content.replace(regex.compsFileCompMarker, ($0, compName) => {
							const compContent = content.substr(content.indexOf($0)+$0.length).split(regex.compsFileCompMarker)[0];
							this.compFilesCache[compName.toLowerCase()] = compContent;
						});
						res();

					})
					.catch(reason => this.error(reason));
			} else {
				let content = window[classId].compsContentHook();
				content && content.replace(regex.compsFileCompMarker, ($0, compName) => {
					const compContent = content.substr(content.indexOf($0)+$0.length).split(regex.compsFileCompMarker)[0];
					this.compFilesCache[compName.toLowerCase()] = compContent;
				});
				content && res();
			}
		});

		//listen for route changes
		this.listenForRoutes();

		//off we go
		ready.then(() => this.loadComponent(this.masterComponent, this.container, this.data+'' == '[object Object]' ? this.data : {}));

	}
	let proto = engine.prototype;

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

			//await new Promise(res => setTimeout(res, 500)); //<-- uncomment to check chronology

			//get component content, from file or cache - if construc.compsFile, must be declared in central components file
			let fp = this.compsPath+'/'+name.toLowerCase()+'.html'+(!this.noCacheCompFiles ? '' : '?r='+Math.round(Math.random() * 10000));
			const content = this.compFilesCache[name] || (!this.compsFile ? await fetch(fp).then(r => r.ok ? r.text() : null) : null);
			fp = fp.replace(/\?.+$/, '');
			if (content === null) {
				let err = 'Could not load component "'+name+'"'+(parentCompObj ? ' from component "'+parentCompObj.name+'"' : '')+' - ';
				err += !window[classId].compsContentHook && this.compsFile ?
					'check filepath at '+fp :
					'no such component definition found';
				return this.error(err+'.');
			} else if (!content)
				return this.error(fp+' is empty!');
			this.compFilesCache[name] = content;
			this.components[name] = this.components[name] || [];

			//component details
			name = name.toLowerCase();
			const isMaster = typeof insertion == 'object' || name == this.masterComponent,
				compInstanceId = isReRender != undefined ? isReRender : this.components[name].length;

			//if is reinstatement from reprocessing conditionals (e.g. from route change), grab the cached DOM content, nothing to do beyond here
			if (isReRender === undefined && this.compDOMsCache[name+'/'+compInstanceId])
				return this.reinstateCompFromCache(name, compInstanceId, res);

			//build component object
			const comp = this.components[name][compInstanceId] = this.buildCompAPI(name, compInstanceId, props, isReRender, parentCompObj, template);

			//re-render? Clear descendant components ahead of them being remade, and clear previously-bound events bindings so not duplicated
			if (isReRender !== undefined) {
				this.clearChildComps(comp);
				for (let evt in this.events)
					this.events[evt][name+'/'+compInstanceId] && delete this.events[evt][name+'/'+compInstanceId];
			}
			
			//extract parts and derive an object with @js, @css and @html parts - only @html is mandatory
			let parts = Object.fromEntries(['css', 'html', 'js'].map(part => [[part], (() => {
					switch (part) {
						case 'css': return content.match(/<style>([\s\S]+?)<\/style>/i);
						case 'html': return content;
						case 'js': return content.match(/<script>([\s\S]*)<\/script>/);
					}
				})()])),
				err;
			if (err = checkCompContent(parts, name)) return this.error(err);
			['css', 'js'].forEach(part => parts.html = parts.html.replace(parts[part] ? parts[part][0] : null, '').trim());

			//output CSS, where applicable
			parts.css && this.buildCompCSS(name, parts.css[1]);

			//treat HTML
			parts.html = this.treatCompHTML(comp, parts.html, props);
			if (!parts.html) return this.error('Failed to find HTML template for component "'+comp.name+'"');

			//render as HTML - initially into temporary element - which element depends on the component's container tag
			comp.DOM = document.createElement(idealParentTag(parts.html));
			comp.DOM.innerHTML = parts.html;
			comp.DOM = comp.DOM.children[0];
			comp.DOM._template = template;
			fromRepSel && comp.DOM.setAttribute(repElAttr, fromRepSel);

			//make DOM elements identifiable as components via symbol
			comp.DOM[engine.component = symbols.component] = comp;

			//repoint inline events to target component methods
			repointInlineEvents(comp.DOM, comp);

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
			!this.compJsFuncs[name] && this.buildCompJS(parts.js ? parts.js[1] : null, comp);
			this.compJsFuncs[name+'/'+compInstanceId](this);

			//rendered (minus descendant components) - fire event - also fire route changed event for starting route. Any component listening in on route changed
			//should be notified of starting route, but its JS runs after starting route established, hence fire manually here.
			this.fireEvent(comp, 'rendered');
			this.fireEvent(comp, 'routeChanged');
			const compAlias = comp;
		
			//render child components
			await this.renderChildComps(comp);

			//cache the component's DOM content where appl. - we may revert to this if it's ever removed by a route change and later reinstated
			if (this.reinsCaching === true || (this.reinsCaching instanceof Array && this.reinsCaching.includes(name)))
				this.compDOMsCache[name+'/'+compInstanceId] = comp.DOM;

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
		if (!css || this.doneCssForCompNames.includes(compName)) return;
		this.doneCssForCompNames.push(compName);

		//...prep sheet
		const sheet = document.createElement('style'),
			compRef = '[data-'+frameworkId+'-comp="'+compName+'"]';
		sheet.setAttribute('data-'+frameworkId+'-comp', compName);
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
		`).bind(compObj);
		func.compObj = compObj;
		this.compJsFuncs[compObj.name+'/'+compObj.instance] = func;
		return func;
	}

	/* ---
	| REPEATERS - re/process repeaters i.e. elements in the template that should be repeated and populated based on an array of data. Args:
	|	@comp (obj)			- the component object
	|	@isProcess (bool)	- if is later reprocess
	|	@sel (str)			- reprocessing only - an optional selector to reprocess or, if omitted, all repeaters are reprocessed
	|	@dataProp (?)		- if came from @comp's proxy setter, the property within @comp's @data object that was changed
	--- */

	proto.processReps = function(comp, isReprocess, sel, dataProp) {

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
				tmpltEl = [...comp.DOM.querySelectorAll(selector)].filter(el => this.checkParentage(el, comp.DOM, 1));
				if (tmpltEl.length > 1)
					return this.error('Repeater selector "'+origSelector+'" targets more than 1 element in component "'+comp.name+'"');
				if (!tmpltEl.length) return;
				const com = comp.repeaterOrigNodes[origSelector] = document.createComment(tmpltEl[0].outerHTML);
				tmpltEl[0].before(com);
				tmpltEl[0].parentNode.removeChild(tmpltEl[0]);
				tmpltEl = com;
			} else
				tmpltEl = comp.repeaterOrigNodes[origSelector];

			//if reprocess - delete any previous repeater els for this selector
			if (isReprocess) {
				let removeChildComps = [];
				[...comp.DOM.querySelectorAll('['+repElAttr+'="'+encodeURIComponent(selector)+'"]')]
					.filter(el => this.checkParentage(el, comp.DOM, 2))
					.forEach(el => {
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
				const tmplt = comp.repeaterOrigNodes[origSelector].nodeValue,
					newHtml = this.parseVars(tmplt, obj, 'reps', comp, i, dataProp),
					frag = document.createElement(idealParentTag(newHtml));
				frag.innerHTML = newHtml;
				repointInlineEvents(frag.children[0], comp);
				frag.children[0].setAttribute(repSelAttr, encodeURIComponent(selector));
				frag.children[0][window[classId].repData = symbols.repData] = obj;
				tmpltEl.before(frag.children[0]);
			});
		}

		//if reprocess, re-render child any components that just became available
		if (isReprocess) this.renderChildComps(comp);

	}

	/* ---
	| CONDITIONALS - re/process conditionals for a component. Happens in one of three scenarios:
	|	1) On component re/render
	|	2) When component's ::reprocessConds/::rc() method is called
	|	3) Automatically, as component data written, if @autoReprocess instantiation param array allows
	| Args:
	|	@comp (obj) 		- as with ::processReps()
	|	@isReprocess (bool)	- " " "
	|	@sel (str)			- " " "
	|	@force (bool)		- if element already showing, and reprocess decides it should still show, it's rerendered (normally left unchanged)
	|						  This means its JS can run again and be fed fresh props.
	|	@dataProp (?)		- if came from @comp's proxy setter, the property within @comp's @data object that was changed
	--- */

	proto.processConds = function(comp, isReprocess, sel, force, dataProp) {

		if (!comp.conditionals) return;

		//establish conditionals - all, or specific
		const conditionals = !sel ? comp.conditionals : {[sel]: comp.conditionals[sel]};

		//iterate over conditionals...
		for (let selector in conditionals) {

			if (!conditionals[selector]) continue;

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
				let comments = [comp.DOM, ...comp.DOM.querySelectorAll('*')].filter(el => this.checkParentage(el, comp.DOM)).reduce((acc, node) =>
					[...acc, ...[...node.childNodes].filter(node => node.nodeType === 8 && new RegExp('^'+noRenderElIdentifier).test(node.nodeValue))]
				, []);
				comments.forEach(comment => {
					const content = comment.nodeValue.replace(noRenderElIdentifier, ''),
						frag = document.createElement(idealParentTag(content));
					frag.innerHTML = this.parseVars(content, comp.data, 'reps', comp, null, dataProp);
					repointInlineEvents(frag.children[0], comp);
					temporarilyRendered.push(frag.children[0]);
					frag.children[0]._template = content;
					comment.replaceWith(frag.children[0]);
				});
			}
			let els = [...comp.DOM.querySelectorAll(selector)].filter(el => this.checkParentage(el, comp.DOM));
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
				}
			});

			if (force) this.processConds(comp, isReprocess, origSelector);

		}

		//if reprocess, re-render child any components that just became available
		if (isReprocess) this.renderChildComps(comp);

	}

	/* ---
	| OUTPUT VARS - as with ::processConds(), but for output, i.e. variables in free-flowing output. Args:
	|	@comp (obj)		- the component object.
	|	@sel (str)		- an optional selector targeting an element within which to process vars (else whole component DOM)
	|	@dataProp (str)	- the name of the property within @comp's @data object that was changed, unless we're re/processing all output
	--- */

	proto.processOutput = function(comp, sel, dataProp) {

		//textnodes/comments bindings
		let context = !sel ? comp.DOM : comp.DOM.querySelector(sel);
		for (let which of ['comment', 'text']) {
			let walker = document.createTreeWalker(context, NodeFilter['SHOW_'+which.toUpperCase()], {acceptNode: node =>
					!!((node.varTmplt || new RegExp('^'+regex.varsAsComments.source+'$').test('<!--'+node.nodeValue+'-->')) && this.checkParentage(node, comp.DOM))
				}),
				nodes = [],
				node;
			while (node = walker.nextNode()) nodes.push(node);
			nodes.forEach(node => {
				let prop = which == 'comment' ? 'nodeValue' : 'varTmplt',
					repl = this.parseVars('<!--'+(node[prop])+'-->', comp.data, 'init', comp, null, dataProp);
				if ((repl || repl === '') && repl.indexOf('<!--') != 0) {
					let tn = document.createTextNode(repl);
					tn.varTmplt = node[prop];
					node.replaceWith(tn);
				}
			});
		}

		//models bindings
		[...context.querySelectorAll('['+compModelAttr+'="'+dataProp+'"]')].filter(el => ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName)).forEach(el =>
			!el.matches('[type=checkbox], [type=radio]') ? el.value = comp.data[dataProp] : el.checked = !!comp.data[dataProp]
		);

	}

	/* ---
	| ATTRIBUTE VARS - as with ::processConds(), but for attributes. Args:
	|	@comp (obj)		- the component object
	|	@attrType (str)	- for when reprocessing attrs manually; an attr name to target, otherwise all
	|	@dataProp (?)	- if came from @comp's proxy setter, the property within @comp's @data object that was changed
	--- */

	proto.processAttrs = function(comp, attrType, dataProp) {

		//get attrs
		let walker = document.createTreeWalker(comp.DOM, NodeFilter.SHOW_ELEMENT, {
				acceptNode: node => !node.matches('['+compPreRenderAttr+']') && this.checkParentage(node, comp.DOM)
			}),
			node,
			els = [],
			attrs = [];
		while (node = walker.nextNode()) {
			els.push(node);
			attrs.push.apply(attrs, !attrType ? [...node.attributes] : [...node.attributes].filter(attr => attr.name === attrType));
		}

		//iterate and do parse vars...
		for (let attr of attrs) {

			let tmplt;
			if (attr.varTmplt)
				tmplt = attr.varTmplt;
			else if (regex.varsAsComments.test(attr.value))
				tmplt = attr.varTmplt = attr.value;
			if (!tmplt) continue;

			attr.value = this.parseVars(tmplt, comp.data, 'init', comp, null, dataProp);

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
			textNodesFromVarCommentTmplts: [],
			instance: compInstanceId,
			renderTime: new Date(),
			reRendered: isReRender !== undefined,
			parent: parentCompObj,
			app: this,
			master: this.components[this.masterComponent][0]
		};
		for (let detail in about) Object.defineProperty(comp, detail, {value: about[detail]});

		//...states: there's two state caches for a component (used when reinstating a component previously allowed, then disallowed, by a
		//parent conditional, provided construc.reinsCaching is true or an array including the component name). There's an indexed states cache,
		//which works like an undo/redo tree, and a persistent states tree, with named states that can't be lost in the way that indexed
		//states can (e.g. if you go to state 1, then go back to 0, then make a new state - a new state 1 is created, and the old is lost)
		comp.activeState = !prevBuild ? 0 : prevBuild.activeState;
		comp.activeIndexedState = !prevBuild ? 0 : prevBuild.activeIndexedState;

		//container for methods and DOM events
		comp.methods = {};
		comp.events = {};

		//some private stuff
		comp.repeaterOrigNodes = {};
		comp.statesCache = prevBuild ? prevBuild.statesCache : [new Proxy(copyObj(comp.data), this.getProxyConfig(comp))];
		comp.persistentStatesCache = prevBuild ? prevBuild.persistentStatesCache : {};

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
					let newProps = outerThis.buildProps(frag.children[0], comp);
					props = Object.assign(props, newProps);
				}
				const func = () => this.loadComponent(name, name, props, compInstanceId, parentCompObj, null, comp.DOM._template);
				outerThis.fullyRenderedTracker[name+'/'+compInstanceId] ? func() : comp.on('fullyRendered', func);
			},

			//...on {event} (see constr.events for valid events) 
			on: on.bind(comp),

			//...reprocess repeaters/conditionals/live attrs
			reprocessReps: (sel, prop) => this.processReps(comp, 1, sel, prop),
			reprocessConds: (sel, prop) => this.processConds(comp, 1, sel, 1, prop),
			reprocessAttrs: (sel, flushCache, prop) => this.processAttrs(comp, sel, prop),
			reprocessOutput: (sel, prop) => this.processOutput(comp, sel, prop),

			//...create dynamic child component - render it, unless it's subject to a conditional
			createChildComponent: (name, css, html, js) => {
				if (!regex.childCompName.test(name)) return this.error(name+' is not a valid child component name in call to createChildComponent() - must start with uppercase letter');
				js = js && js.toString().replace(regex.dynamicCompJsBody, '');
				this.compFilesCache[name.toLowerCase()] = (css ? '<style>'+css+'</style>' : '')+html+(js ? '<script>'+js+'</script>' : '');
				return {
					insert: (el, props = {}, how = 'append') => {
						let willBeChild = /ppend$/.test(how);
						if (!['append', 'prepend', 'after', 'before'].includes(how)) return this.error(how+' is not a valid insertion instruction in call to createChildComponent()');
						let tmp = document.createElement(childCompTmpTagName((willBeChild ? el : el.parentNode).tagName)),
							compName = name.toLowerCase();
						tmp.setAttribute(compPreRenderAttr, compName);
						el[how+(willBeChild ? 'Child' : '')](tmp);
						!comp.conditionals || !comp.conditionals[name] ?
							this.loadComponent(compName, compName, props, undefined, comp) :
							comp.rc(name);
					}
				}
			},

			//...message (another component)
			message: (xpath, data) => this.compMessage(comp, xpath.toLowerCase(), data),

			//...activate route (or change data of current route) - @data is a segmented list or a JSON string / JS object denoting to the route
			go: this.go = data => {
				if (!['string', 'object'].includes(typeof data)) return this.error('route change - passed data must be string or object');
				let uri = typeof data == 'string' ? data : JSON.stringify(data);
				if (!this.usePushState)
					location.assign('#/'+uri);
				else {
					history.pushState(null, null, uri);
					this.checkRoutes();
				}
			},

			//...new state - @persist is an optional persistent state name (otherwise indexed state assumed)
			newState: persist => {
				const data = new Proxy(copyObj(comp.data), outerThis.getProxyConfig(comp));
				if (!persist) {
					comp.activeIndexedState++;
					comp.activeState = comp.activeIndexedState;
					comp.statesCache[comp.activeState] = data;
					comp.statesCache = comp.statesCache.slice(0, comp.activeState + 1);
				} else {
					comp.activeState = persist;
					comp.persistentStatesCache[persist] = data;
				}
				return persist || comp.activeState;
			},

			//...change state - @which is an index or persistent state name. comp.activeState is set to @which (if a persistent state,
			//an internal tracker, comp.activeIndexedState, remembers the indexed position (any future 'next'/'prev' will be from
			//that index)....
			changeState: which => {

				let valid = false;

				//...index (int)
				if (typeof which == 'number') {
					if (comp.statesCache[which]) {
						comp.data = comp.statesCache[which];
						valid = 1;
						comp.activeState = comp.activeIndexedState = which;
					} else {
						this.error('no such state for component '+comp.name+'/'+comp.instance+', "'+which+'"');
						return false;
					}

				//...index ('next'/'prev' alias)
				} else if (['next', 'prev'].includes(which)) {
					which = comp.activeIndexedState + (which == 'next' ? 1 : -1);
					if (comp.statesCache[which]) {
						comp.data = comp.statesCache[which];
						valid = 1;
						comp.activeState = comp.activeIndexedState = which;
					}
				}

				//...persistent state - @activeState will remain where it is - that's for the indexed states cache only
				else if (comp.persistentStatesCache[which]) {
					valid = 1;
					comp.data = comp.persistentStatesCache[which];
					comp.activeState = which;
				}

				//valid request - reprocess comp's output/attrs/conds/reps
				if (valid) this.doAutoReprocess(comp);

				//no such state
				else return false;

			}

		};

		//...method shortcuts
		methods.rc = methods.reprocessConds;
		methods.ra = methods.reprocessAttrs;
		methods.rr = methods.reprocessReps;
		methods.ro = methods.reprocessOutput;
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

		//quote var-containing attributes - else the trailing '>' of the comment-based var pattern, if used in unquoted attrs, will be parsed as closing the element
		html = html.replace(new RegExp('(\\s+[\\w-]+=)('+regex.vars.source+')(?=\\s+(\\/?>|[\\w-]+=))'), (match, $0, $1) => $0+'"'+$1+'"');

		//swap child component templates for suitable, valid HTML elements based on parent tag
		html = html.replace(regex.childCompTags, (match, compName) => {
			let parentTag = html.match(regex.parentTag.source+'<'+compName);
			let replTag = childCompTmpTagName(parentTag[1]);
			return match
				.replace('<'+compName, '<'+replTag+' '+compPreRenderAttr+'='+compName.toLowerCase())
				.replace(/ *\/(?=>$)/, '')
				+'</'+replTag+'>';
		});


		//convert var placeholders to HTML comment form, so they don't render until (and unless) parsed
		html = varsToCommentVars(html);

		//do initial parsing of vars (we'll do another sweep later, for repeaters)
		html = this.parseVars(html, props, 'init', compObj);

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
		const comp = this.compJsFuncs[name+'/'+instance].compObj;

		//reinstate it in this.components
		this.components[name][instance] = comp;

		//set its DOM to the cached DOM from when it was last around
		comp.DOM = this.compDOMsCache[name+'/'+instance];

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
	|	@repIteration (?)				- ?
	|	@prop (?)						- a specific property of @comp's @data object that we're parsing, rather than all
	--- */

	proto.parseVars = function(str, pool, stage, comp, repIteration, prop) {

		let val;
		return str.replace(regex.varsAsComments, (match, varName, filterMethod, fmCache) => {

			if (prop && !new RegExp(':'+prop+'($|\|)').test(match)) return pool[varName] || match;
			
			//run through a filter method (of the app, or the component)? If so, live or cached value?
			let fmFunc = filterMethod && ((comp.methods || {})[filterMethod] || this.methods[filterMethod]);
			fmFunc = !fmFunc ? null : (fmFunc => (val, comp) => {
				if (!fmFunc) return null;
				fmFunc[symbols.fmCache] = fmFunc[symbols.fmCache] || new Map();
				if (!fmCache || !fmFunc[symbols.fmCache].has(val)) {
					let freshVal = fmFunc(val, comp);
					fmFunc[symbols.fmCache].set(val, freshVal);
					return freshVal;
				}
				return fmFunc[symbols.fmCache].get(val);
			})(fmFunc, comp);

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
					for (let evt in this.events)
						for (let compId in this.events[evt])
							new RegExp('^'+compName+'/').test(compId) && delete this.events[evt][compId];

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
		let nodes = comp.DOM.querySelectorAll('['+compPreRenderAttr+']');
		for (let node of [...nodes]) {

			//...due to asynchronicity we may already have processed this node. Also skip if is not directly part of this component.
			if (!node.parentNode || !this.checkParentage(node, comp.DOM)) continue;

			//...prep props
			let compName = node.getAttribute(compPreRenderAttr),
				template = node._template || node.outerHTML,
				props = this.buildProps(node, comp);

			//render
			await this.loadComponent(compName, compName, props, undefined, comp, node.getAttribute(repElAttr), template);
		};
	}

	/* ---
	| ATTACH EVENT - listen for a given lifecycle (not DOM) event relating to a component. Proxied to comp.on() (and so called in the context
	| of the component object). Args:
	|	@event (str)		- the event to listen on - one of those declared in ::events
	|	@cb (func)			- the callback
	--- */

	function on(evt, cb) {

		//prep - locate app: this or, if being called from/in context of component, this.app
		const errTmplt = 'Missing/invalid {what} passed to on() from component "'+this.name+'"';
		if (!Object.keys(this.app.events).includes(evt)) return this.app.error(errTmplt.replace('{what}', 'event type "'+(evt || '')+'"'));
		if (typeof cb != 'function') return this.app.error(errTmplt.replace('{what}', 'callback function (for event type "'+evt+'")'));

		//save to events cache
		let key = this.name+'/'+this.instance;
		if (!this.app.events[evt][key]) this.app.events[evt][key] = [];
		this.app.events[evt][key].push(cb);

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
			this.events[evt][key] && this.events[evt][key].forEach(cb => cb.apply(comp, [...arguments].slice(2)));
		});
	}

	/* ---
	| ROUTES - VALIDATE - from constructor, validate @routes map. Returns error string if any, else undefined if OK.
	--- */

	proto.validateRoutes = function() {

		//...must be object
		if (this.routes.toString() != '[object Object]')
			return '@routes, if specified, must be an object of route IDs to config objects';

		//...check each route (default one, if set, has no @type or @ptn)
		let err;
		Object.entries(this.routes).forEach(entry => {
			if (!routeTypes.includes(entry[1].type))
				err = 'missing or invalid @type property for route "'+entry[0]+'" - should be "'+routeTypes.join('" or "')+'"';
			else if (entry[1].type == 'seg' && !(entry[1].ptn instanceof RegExp))
				err = 'missing or invalid @ptn (pattern property for route "'+entry[0]+'" - should be a RegExp pattern';
		});

		if (err) return err;

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
		addEventListener(!this.usePushState ? 'hashchange' : 'popstate', this.checkRoutes = evt => {

			//prep - get current hash (or pushstate URI, if using pushstate)
			const hash = decodeURIComponent(!this.usePushState ? location.hash.replace(/^#\/?/, '') : location.pathname.replace(startUri, ''));
			let foundRoute;

			//in some page unload scenarios the hash change event can fire even if there's no actual change; guard against htis
			if (this.hasOwnProperty('lastHash') && this.lastHash == hash) return;
			this.lastHash = hash;

			//iterate over routes (every() ensures we can break from the loop if and when a falsy is returned)...
			Object.entries(this.routes).every(entry => {

				//...segment-based route...
				if (entry[1].type == 'seg') {

					//...validate pattern, unless is default route (which has none)
					if (!entry[1].ptn || !(entry[1].ptn instanceof RegExp))
						return this.error('Route "'+entry[0]+'" does not have a @ptn (pattern) property or is not a RegExp pattern');

					const segs = hash.split('/').filter(seg => seg);

					//...matches pattern? Gather up data if so
					if (entry[1].ptn.test(hash)) {
						foundRoute = 1;
						const data = entry[1].parts ?
							entry[1].parts.reduce((acc, val, i) => {
								acc[val] = segs[i+1];
								return acc;
							}, {}) :
							segs.slice(1).reduce((acc, val, i) => {
								acc[i] = val;
								return acc;
							}, {});
						this.activeRoute = entry[0];
						this.routeData = data;
						return;
					}

				//...JSON-based route
				} else {
					try {
						const data = JSON.parse(hash);
						if (!data.route || data.route != routeId) return;
						foundRoute = 1;
						delete data.route;
						this.activeRoute = entry[0];
						this.routeData = data;
						return;
					} catch(e) {}
				}

				return 1; //so every() keeps running

			});

			//if no active route, set active route to undefined
			if (!foundRoute) this.activeRoute = undefined;

			//does the route have an auto data fetch()? Fetch if so and fire routeFetched event on resolve (or routeFetchError on failure)
			let dataFetch;
			if (foundRoute && this.routes[this.activeRoute].dataUri) {
				let uri = this.routes[this.activeRoute].lastFetchUri = this.routes[this.activeRoute].dataUri;
				if (typeof uri == 'function') uri = uri(this.routeData, this);
				dataFetch = fetch(uri);
				dataFetch
					.then(response => {
						response = response.clone(); //<-- otherwise if user consumes response manually, they'll get an "already consumed" error (bit.ly/3qRYiCb)
						if (!response.ok) return this.fireEvent(null, 'routeFetchError', response);
						let mime = response.headers.get('content-type');
						if (!mime) return response.text();
						mime = mime.split(/\/|;/)[1];
						return response[mime] ? response[mime]() : response.text();
					})
					.then(data => {
						this.fetchedRouteData = data;
						this.fireEvent(null, 'routeFetched', data);
					});
			}

			//notify any listening components - feed the data fetch(), if any
			this.fireEvent(null, 'routeChanged', dataFetch);

		});
		this.checkRoutes();
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
	| AUTO-REPROCESS - auto-reprocess any construct types allowed by the @autoReprocess instantiation param array - output (template vars), attrs, conds and reps. Args:
	|	@comp (obj)	- the component object.
	|	@prop (?)	- if this came from the proxy setter, the property within the component's object that was changed
	--- */

	proto.doAutoReprocess = function(comp, prop) {
		this.autoReprocess.includes('conds') && comp.rc(null, prop);
		this.autoReprocess.includes('attrs') && comp.ra(null, null, prop);
		this.autoReprocess.includes('reps') && comp.rr(null, prop);
		this.autoReprocess.includes('output') && comp.ro(null, prop);
	}

	/* ---
	| PROXY CONFIG - return a config object for a proxy. On data write, auto-reprocess parts allowed by @autoReprocess instantiation params array. Args:
	|	@comp (obj)	- the component object
	--- */

	proto.getProxyConfig = function(comp) {
		let outerThis = this;
		return {
			get(obj, prop) { return typeof obj[prop] == 'object' && obj[prop] !== null ? new Proxy(obj[prop], outerThis.getProxyConfig(comp)) : obj[prop]; },
			set(obj, prop, val) {
				obj[prop] = val;
				outerThis.doAutoReprocess(comp, prop);
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

	proto.buildProps = function(node, comp) {
		let props = {};
		[...node.attributes].filter(attr => !/^(_|data-)/.test(attr.name)).forEach(attr => {
			if (!regex.varsAsComments.test(attr.value)) {
				const complex = attr.value.match(regex.complexType);
				props[attr.name] = !complex ? attr.value : complexObjs[complex[1]];
			} else
				props[attr.name] = this.parseVars(attr.value, comp.data, 'init', comp);
		});
		return props;
	}

	/* ---
	| (UTIL) - CHECK PARENTAGE - check an element is a direct child of a parent component, not a deeper component. Args:
	|	@el (obj)		- the element
	|	@compEl (obj)	- the DOM of the parent component that @el should live under
	| #### TO DO - killed for now (returns true) as results in duplicate repeater items in to-app app ####
	--- */

	proto.checkParentage = function(el, compEl) {
		return 1;
		el = [3, 8].includes(el.nodeType) ? el.parentNode : el;
		return el.closest('['+compRenderedAttr+']') === compEl;
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
		if (!childCompTag) return;
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
	| (UTIL) VAR FORMAT - format braces-based vars i.e. {{foo}} to comment-based vars e.g. <!--lucid-var:foo-->
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

	/* ---
	| (UTIL) - REPOINT INLINE EVENTS - repoint inline event handlers to run in context of component
	|	@el (obj)	- the element to act on and within
	|	@comp (obj)	- the associated component
	--- */

	function repointInlineEvents(el, comp) {
		[el, ...el.querySelectorAll('*')].filter(el => / _?on[a-z]+=/.test(el.outerHTML)).forEach(el =>
			[...el.attributes].filter(attr => /^_?on/.test(attr.name)).forEach(attr => {
				el.setAttribute(('_'+attr.name).replace(/^_{2,}/, ''), attr.value);
				el.removeAttribute(attr.name);
				el[attr.name.replace(/^_/, '')] = function(evt) {
					let evtStr = attr.value.match(/^([_a-z]+)(?:\(([^\)]*)\))?$/i);
					if (evtStr && this.events[evtStr[1]])
						eval('('+comp.events[evtStr[1]]+')('+evtStr[2]+')');
					else
						eval(attr.value);
				}.bind(comp);
			})
		);
	}

	return engine;

})();
