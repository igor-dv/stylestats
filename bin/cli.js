#!/usr/bin/env node

'use strict';

var _ = require('underscore');
var fs = require('fs');
var chalk = require('chalk');
var program = require('commander');

var StyleStats = require('../lib/stylestats');
var Format = require('../lib/format');
var util = require('../lib/util');

program
  .version(require('../package.json').version)
  .usage('[options] <file ...>')
  .option('-c, --config [path]', 'Path and name of the incoming JSON file.')
  .option('-t, --type [format]', 'Specify the output format. <json|html|csv>')
  .option('-s, --simple', 'Show compact style\'s log.')
  .option('-g, --gzip', 'Show gzipped file size.')
  .option('-n, --number', 'Show only numeral metrics.')
  .option('-u, --ua [OS]', 'Specify the user agent. <ios|android>')
  .option('-f, --savefile [path]', 'Save to file. <pathToFile>')
  .parse(process.argv);

if (!program.args.length) {
  console.log(chalk.red('\n No input file specified.'));
  program.help();
}

// Config
var config = {
  requestOptions: {
    headers: {}
  }
};
if (program.gzip) {
  config.gzippedSize = true;
}
if (program.ua) {
  var iOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 7_0 like Mac OS X) AppleWebKit/537.51.1 (KHTML, like Gecko) Version/7.0 Mobile/11A465 Safari/9537.53';
  var Android = 'Mozilla/5.0 (Linux; Android 4.4; Nexus 5 Build/KRT16M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/31.0.1650.59 Mobile Safari/537.36';
  switch (program.ua) {
    case 'ios':
      config.requestOptions.headers['User-Agent'] = iOS;
      break;
    case 'android':
      config.requestOptions.headers['User-Agent'] = Android;
      break;
    default:
      console.error(chalk.yellow(' [WARN] User agent should be `ios` or `android`.'));
      break;
  }
}
if (program.number) {
  var numberConfig = {
    "published": false,
    "paths": false,
    "mostIdentifierSelector": false,
    "lowestCohesionSelector": false,
    "uniqueFontSize": false,
    "uniqueColor": false,
    "propertiesCount": false
  };
  _.extend(config, numberConfig);
}
var userConfig = {};
if (program.config && util.isFile(program.config)) {
  var configString = fs.readFileSync(program.config, {
    encoding: 'utf8'
  });
  try {
    userConfig = JSON.parse(configString);
  } catch (e) {
    throw e;
  }
} else if (_.isObject(program.config)) {
  userConfig = config;
}
_.extend(config, userConfig);


// Parse
var stats = new StyleStats(program.args, config);
stats.parse(function (error, result) {
  if (error) {
    console.log(chalk.red(' [ERROR] ' + error.message));
  }

  var saveOrLog = function(content){
    if(program.savefile) {
        fs.writeFile(program.savefile, content, function(err) {
            if(err) { console.log(err); } 
            else { console.log("The file was saved!"); }
        });
      }
      else {
        console.log(content);
      }
  }

  var format = new Format(result, program.simple);
  switch (program.type) {
    case 'json':
      format.toJSON(function (json) {
        saveOrLog(json)
      });
      break;
    case 'safe-json':
      format.toSafeJSON(function (json) {
        saveOrLog(json)
      });
      break;
    case 'csv':
      format.toCSV(function (csv) {
        saveOrLog(csv);
      });
      break;
    case 'html':
      format.toHTML(function (html) {
        saveOrLog(html);
      });
      break;
    default:
      format.toTable(function (table) {
        saveOrLog(' StyleStats!\n' + table);
      });
      break;
  }
});