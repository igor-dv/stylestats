var _ = require('underscore');
var gzipSize = require('gzip-size');
var CssSelectorParser = require('css-selector-parser').CssSelectorParser;

function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) + (r*1 << 16) + (g*1 << 8) + b*1).toString(16).slice(1);
}

/**
 * Analyzer class
 * @param {Array} rules
 * @param {Array} selectors
 * @param {Array} declarations
 * @param {String} cssString
 * @param {Number} cssSize
 * @param {Object} options
 * @constructor
 */
function Analyzer(rules, selectors, declarations, cssString, cssSize, options, sourceMap) {

  // array of rule
  // referenced in analyzeRules
  this.rules = rules;

  // array of css selector
  // referenced in analyzeSelectors
  this.selectors = selectors;

  // array of css declaration
  // referenced in analyzeDeclarations
  this.declarations = declarations;

  // all of css string
  this.cssString = cssString;

  // size of css
  this.cssSize = cssSize;

  // result options
  this.options = options;

  this.sourceMap = sourceMap;
}

/**
 * Analyze rules
 * @returns {
 *   {Array} cssDeclarations
 * }
 */
Analyzer.prototype.analyzeRules = function () {

  // object to return
  var result = {
    cssDeclarations: []
  };

  // analyze rules
  this.rules.forEach(function (rule) {
    if (Array.isArray(rule.declarations)) {
      result.cssDeclarations.push({
        selector: rule.selectors,
        count: rule.declarations.length
      });
    }
  });

  // sort by css declaration count
  result.cssDeclarations.sort(function decreasingOrder(a, b) {
    return b.count - a.count;
  });

  return result;
};

/**
 * Analyze selectors
 * @returns {
 *   {Number} idSelectors,
 *   {Number} universalSelectors,
 *   {Number} unqualifiedAttributeSelectors,
 *   {Number} javascriptSpecificSelectors,
 *   {Array} identifiers
 * }
 */
Analyzer.prototype.analyzeSelectors = function () {

  var selectorParser = new CssSelectorParser();
  selectorParser.registerSelectorPseudos('has');
  selectorParser.registerNestingOperators('>', '+', '~');
  selectorParser.registerAttrEqualityMods('^', '$', '*', '~');
  selectorParser.enableSubstitutes();

  // object to return
  var result = {
    idSelectors: 0,
    universalSelectors: 0,
    attributeSelectors: 0,
    unqualifiedAttributeSelectors: 0,
    javascriptSpecificSelectors: 0,
    elementSelectors: 0,
    classSelectors: 0,
    identifiers: []
  };

  // specified JavaScript hook selector
  var regexp = new RegExp(this.options.javascriptSpecificSelectors, 'g');

  // analyze selectors
  this.selectors.forEach(function (selector) {

    var ps = selectorParser.parse(selector);
    var rule = ps.rule;

    var hasClass = false;
    var hasTag = false;
    var hasId = false;
    var hasAttr = false;
    var hasUnqAttr = false;
    var hasUniversal = false;

    while(rule) {
      if (rule.id)
        hasId = true;

      if (rule.classNames && rule.classNames.length)
        hasClass = true;

      if (rule.tagName) {
        hasTag = true;
        if (rule.tagName == '*')
          hasUniversal = true;
      }

      if (rule.attrs && rule.attrs.length) {
        hasAttr = true;
        if (!rule.tagName && !rule.id && !rule.classNames)
          hasUnqAttr = true;
      }

      rule = rule.rule;
    }

    if (hasId) {
      result.idSelectors += 1;
    }

    if (hasUniversal) {
      result.universalSelectors += 1;
    }

    if (hasUnqAttr) {
      result.unqualifiedAttributeSelectors += 1;
    }

    if (hasAttr) {
      result.attributeSelectors += 1;
    }

    if(hasTag)
      result.elementSelectors += 1;

    if(hasClass)
      result.classSelectors += 1;

    // if it is for JavaScript hook
    if (regexp.test(selector.trim())) {
      result.javascriptSpecificSelectors += 1;
    }

    // add selector for statistics
    var trimmedSelector = selector.replace(/\s?([\>|\+|\~])\s?/g, '$1');
    trimmedSelector = trimmedSelector.replace(/\s+/g, ' ');
    var count = trimmedSelector.split(/\s|\>|\+|\~/).length;
    result.identifiers.push({
      selector: selector,
      count: count
    });
  });

  // sort by chained selector count
  result.identifiers.sort(function decreasingOrder(a, b) {
    return b.count - a.count;
  });

  return result;
};

/**
 * Analyze declarations
 * @returns {
 *   {String} dataUriSize,
 *   {Number} importantKeywords,
 *   {Number} floatProperties,
 *   {Array} uniqueFontSize,
 *   {Array} uniqueFontFamily
 *   {Array} uniqueColor,
 *   {Object} properties
 * }
 */
Analyzer.prototype.analyzeDeclarations = function () {

  var self = this;

  // object to return
  var result = {
    dataUriSize: '',
    importantKeywords: 0,
    floatProperties: 0,
    uniqueFontSize: [],
    uniqueFontSizeDic: {},
    uniqueFontFamily: [],
    uniqueFontFamilyDic: {},
    uniqueColor: [],
    uniqueColorDic: {},
    properties: {}
  };
  var unhandledColors = {};
  var namedColors = this.options.namedColors;
  var namedColorsRegex = new RegExp(namedColors.map(function(nc) { return '\\W(' + nc + ')\\b|^(' + nc + ')\\b'; }).join('|'), 'i');
  var rgbRegex = /rgba*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*.*\)/;
  var hexColorRegex = /#(\w*)/;
  var gradientRegex = /gradient/;
  var colorPropertyRegex = /^color$|^background$|^background-color$|^border/;

  // analyze declarations
  this.declarations.forEach(analyzeDeclaration);

  dataUriSizeToBytes();

  sortAnalyzeData();

  function analyzeDeclaration(declaration) {
    // if it contains DataURI
    if (declaration.value.indexOf('data:image') > -1) {
      result.dataUriSize += declaration.value.match(/data\:image\/[A-Za-z0-9;,\+\=\/]+/);
    }

    // if it contains !important keyword
    if (declaration.value.indexOf('!important') > -1) {
      result.importantKeywords += 1;
    }

    // if it contains float
    if (declaration.property.indexOf('float') > -1) {
      result.floatProperties += 1;
    }

    // if it contains font-family
    if (declaration.property.indexOf('font-family') > -1) {
      var fFamily = declaration.value.replace(/(\!important)/g, '').trim();
      var count = result.uniqueFontFamilyDic[fFamily];

      result.uniqueFontFamilyDic[fFamily] = count ? ++count : 1;
      result.uniqueFontFamily.push(fFamily);

      addToSourceMap('font-family', fFamily, declaration.source);
    }

    // if it contains font-size
    if (declaration.property.indexOf('font-size') > -1) {
      var fSize = declaration.value.replace(/\!important/, '').trim();
      var count = result.uniqueFontSizeDic[fSize];

      result.uniqueFontSizeDic[fSize] = count ? ++count : 1;
      result.uniqueFontSize.push(fSize);

      addToSourceMap('font-size', fSize, declaration.source);
    }

    // if it contains color or background or background-color or border
    if(declaration.property.match(colorPropertyRegex)){
      var colors = extractColor(declaration.value);

      var addedColors = addColor(colors);

      if(!addedColors || !addedColors.length){
        var color = declaration.value;
        var count = unhandledColors[color];
        unhandledColors[color] = count ? ++count : 1;
      }
      else {
        addedColors.forEach(function(c){
          addToSourceMap('color', c, declaration.source);
        });
      }
    }

    // property statistics
    if (result.properties[declaration.property]) {
      result.properties[declaration.property] += 1;
    } else {
      result.properties[declaration.property] = 1;
    }
  }

  function addColor(colors){

    var resultColors = [];

    if(!colors)
      return resultColors;

    if(!Array.isArray(colors))
      colors = [colors];

    colors.forEach(function(color) {
      color = color.replace(/\!important/, '')
      color = color.toUpperCase().trim();

      if (/^#([0-9A-F]){3}$/.test(color)) {
        color = color.replace(/^#(\w)(\w)(\w)$/, '#$1$1$2$2$3$3');
      }

      if(color != 'TRANSPARENT' && color != 'INHERIT') {
        resultColors.push(color);
        var count = result.uniqueColorDic[color];
        result.uniqueColorDic[color] = count ? ++count : 1;
        result.uniqueColor.push(color);
      }
    });

    return resultColors;
  }

  function extractColor(value) {

    var gradient = value.match(gradientRegex);
    if (gradient) {
      return undefined;
    }

    var rgb = value.match(rgbRegex);
    if (rgb) {
      return [rgbToHex(rgb[1], rgb[2], rgb[3])];
    }

    var hexColor = value.match(hexColorRegex);
    if (hexColor) {
      return ['#' + hexColor[1]];
    }

    var namedColor = value.match(namedColorsRegex);
    if (namedColor) {
      return namedColor.slice(1).filter(function (nc) {
        return nc;
      });
    }

    return undefined;
  }

  function sortAnalyzeData() {
    // Sort `font-family` property.
    result.uniqueFontFamily = _.sortBy(_.uniq(result.uniqueFontFamily));

    // Sort `font-size` property.
    result.uniqueFontSize = _.sortBy(_.uniq(result.uniqueFontSize).slice(), function (item) {
      return item.replace(/[^0-9\.]/g, '') - 0;
    });

    // Sort `color` property.
    result.uniqueColor = _.sortBy(_.uniq(result.uniqueColor));

    // Sort properties count.
    var propertiesCount = [];
    Object.keys(result.properties).forEach(function (key) {
      propertiesCount.push({
        property: key,
        count: result.properties[key]
      });
    });

    // sort by property count
    result.properties = propertiesCount.sort(function decreasingOrder(a, b) {
      return b.count - a.count;
    });
  }

  function dataUriSizeToBytes(){
    // Return byte size.
    result.dataUriSize = Buffer.byteLength(result.dataUriSize, 'utf8');
  }

  function addToSourceMap(groupName, item, source){

    var group = self.sourceMap.values[groupName];

    if(!group) {
      group = {};
      self.sourceMap.values[groupName] = group;
    }

    var sources = group[item];

    if(!sources) {
      group[item] = [source];
    }
    else if(sources.indexOf(source) < 0){
      sources.push(source);
    }
  }

  return result;
};

/**
 * Analyze css from rules, selectors, declarations
 * @returns {
 *   {Number} stylesheets,
 *   {Number} size,
 *   {Number} dataUriSize,
 *   {Number} ratioOfDataUriSize,
 *   {Number} gzippedSize,
 *   {Number} rules,
 *   {Number} selectors,
 *   {Float}  simplicity,
 *   {Number} mostIdentifier,
 *   {String} mostIdentifierSelector,
 *   {Number} lowestCohesion,
 *   {Number} lowestCohesionSelector,
 *   {Number} totalUniqueFontSizes,
 *   {String} uniqueFontSize,
 *   {Number} totalUniqueFontFamilies,
 *   {String} uniqueFontSize,
 *   {Number} totalUniqueColors,
 *   {String} uniqueColor,
 *   {Number} totalUniqueFontFamilies
 *   {String} uniqueFontFamily,
 *   {Number} idSelectors,
 *   {Number} universalSelectors,
 *   {Number} unqualifiedAttributeSelectors,
 *   {Number} javascriptSpecificSelectors,
 *   {Number} importantKeywords,
 *   {Number} floatProperties,
 *   {Number} propertiesCount
 * }
 */
Analyzer.prototype.analyze = function () {

  // get analytics
  var ruleAnalysis = this.analyzeRules();
  var selectorAnalysis = this.analyzeSelectors();
  var declarationAnalysis = this.analyzeDeclarations();
  var analysis = {};

  if (this.options.size) {
    analysis.size = this.cssSize;
  }
  if (this.options.dataUriSize) {
    analysis.dataUriSize = declarationAnalysis.dataUriSize;
  }
  if (this.options.dataUriSize && this.options.ratioOfDataUriSize && declarationAnalysis.dataUriSize !== 0) {
    analysis.ratioOfDataUriSize = declarationAnalysis.dataUriSize / this.cssSize;
  }
  if (this.options.gzippedSize) {
    analysis.gzippedSize = gzipSize.sync(this.cssString);
  }
  if (this.options.rules) {
    analysis.rules = this.rules.length;
  }
  if (this.options.selectors) {
    analysis.selectors = this.selectors.length;
  }
  if (this.options.rules && this.options.selectors && this.options.simplicity) {
    analysis.simplicity = analysis.rules / analysis.selectors;
  }
  if (this.options.mostIdentifierSelector && this.options.mostIdentifierCount) {
    analysis.mostIdentifierSelector = selectorAnalysis.identifiers.slice(0, this.options.mostIdentifierCount).map(function(identifier) { return identifier.selector});
  }
  var mostIdentifier = selectorAnalysis.identifiers.shift();
  if (mostIdentifier && this.options.mostIdentifier) {
    analysis.mostIdentifier = mostIdentifier.count;
  }
  var lowestDefinition = ruleAnalysis.cssDeclarations.shift();
  if (lowestDefinition && this.options.lowestCohesion) {
    analysis.lowestCohesion = lowestDefinition.count;
  }
  if (lowestDefinition && this.options.lowestCohesionSelector) {
    analysis.lowestCohesionSelector = lowestDefinition.selector;
  }
  if (this.options.totalUniqueFontSizes) {
    analysis.totalUniqueFontSizes = declarationAnalysis.uniqueFontSize.length;
  }
  if (this.options.uniqueFontSize) {
    analysis.uniqueFontSize = declarationAnalysis.uniqueFontSize;
  }
  if (this.options.uniqueFontSizeDic) {
    analysis.uniqueFontSizeDic = declarationAnalysis.uniqueFontSizeDic;
  }
  if (this.options.totalUniqueFontFamilies) {
    analysis.totalUniqueFontFamilies = declarationAnalysis.uniqueFontFamily.length;
  }
  if (this.options.uniqueFontFamily) {
    analysis.uniqueFontFamily = declarationAnalysis.uniqueFontFamily;
  }
  if (this.options.uniqueFontFamilyDic) {
    analysis.uniqueFontFamilyDic = declarationAnalysis.uniqueFontFamilyDic;
  }
  if (this.options.totalUniqueColors) {
    analysis.totalUniqueColors = declarationAnalysis.uniqueColor.length;
  }
  if (this.options.uniqueColor) {
    analysis.uniqueColor = declarationAnalysis.uniqueColor;
  }
  if (this.options.uniqueColorDic) {
    analysis.uniqueColorDic = declarationAnalysis.uniqueColorDic;
  }
  if (this.options.idSelectors) {
    analysis.idSelectors = selectorAnalysis.idSelectors;
  }
  if (this.options.universalSelectors) {
    analysis.universalSelectors = selectorAnalysis.universalSelectors;
  }
  if (this.options.unqualifiedAttributeSelectors) {
    analysis.unqualifiedAttributeSelectors = selectorAnalysis.unqualifiedAttributeSelectors;
  }
  if (this.options.attributeSelectors) {
    analysis.attributeSelectors = selectorAnalysis.attributeSelectors;
  }
  if (this.options.elementSelectors) {
    analysis.elementSelectors = selectorAnalysis.elementSelectors;
  }
  if (this.options.classSelectors) {
    analysis.classSelectors = selectorAnalysis.classSelectors;
  }
  if (this.options.javascriptSpecificSelectors) {
    analysis.javascriptSpecificSelectors = selectorAnalysis.javascriptSpecificSelectors;
  }
  if (this.options.importantKeywords) {
    analysis.importantKeywords = declarationAnalysis.importantKeywords;
  }
  if (this.options.floatProperties) {
    analysis.floatProperties = declarationAnalysis.floatProperties;
  }
  if (this.options.propertiesCount) {
    analysis.propertiesCount = declarationAnalysis.properties.slice(0, this.options.propertiesCount);
  }
  if (this.options.sourceMap) {
    analysis.sourceMap = this.sourceMap;
  }

  return analysis;
};

module.exports = Analyzer;
