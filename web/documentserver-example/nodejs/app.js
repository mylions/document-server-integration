﻿'use strict';
/**
 *
 * (c) Copyright Ascensio System SIA 2023
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

// connect the necessary packages and modules
const express = require('express');
const path = require('path');
const favicon = require('serve-favicon');
const bodyParser = require('body-parser');
const fileSystem = require('fs');
const formidable = require('formidable');
const jwt = require('jsonwebtoken');
const config = require('config');
const configServer = config.get('server');
const mime = require('mime');
const DocManager = require('./helpers/docManager');
const documentService = require('./helpers/documentService');
const fileUtility = require('./helpers/fileUtility');
const wopiApp = require('./helpers/wopi/wopiRouting');
const users = require('./helpers/users');
const siteUrl = configServer.get('siteUrl');
const fileChoiceUrl = configServer.has('fileChoiceUrl') ? configServer.get('fileChoiceUrl') : '';
const plugins = config.get('plugins');
const cfgSignatureEnable = configServer.get('token.enable');
const cfgSignatureUseForRequest = configServer.get('token.useforrequest');
const cfgSignatureAuthorizationHeader = configServer.get('token.authorizationHeader');
const cfgSignatureAuthorizationHeaderPrefix = configServer.get('token.authorizationHeaderPrefix');
const cfgSignatureSecretExpiresIn = configServer.get('token.expiresIn');
const cfgSignatureSecret = configServer.get('token.secret');
const urllib = require('urllib');
const { emitWarning } = require('process');
const verifyPeerOff = configServer.get('verify_peer_off');

if (verifyPeerOff) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

String.prototype.hashCode = function () {
  const len = this.length;
  let ret = 0;
  for (let i = 0; i < len; i += 1) {
    ret = Math.trunc(31 * ret + this.charCodeAt(i));
  }
  return ret;
};
String.prototype.format = function (...args) {
  let text = this.toString();

  if (!args.length) return text;

  for (let i = 0; i < args.length; i += 1) {
    text = text.replace(new RegExp(`\\{${i}\\}`, 'gi'), args[i]);
  }

  return text;
};


const app = express(); // create an application object
app.disable('x-powered-by');
app.set('views', path.join(__dirname, 'views')); // specify the path to the main template
app.set('view engine', 'ejs'); // specify which template engine is used


app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // allow any Internet domain to access the resources of this site
  next();
});

app.use(express.static(path.join(__dirname, 'public'))); // public directory
// check if there are static files such as .js, .css files, images, samples and process them
if (config.has('server.static')) {
  const staticContent = config.get('server.static');
  for (let i = 0; i < staticContent.length; i += 1) {
    const staticContentElem = staticContent[i];
    app.use(staticContentElem.name, express.static(staticContentElem.path, staticContentElem.options));
  }
}
app.use(favicon(`${__dirname}/public/images/favicon.ico`)); // use favicon


app.use(bodyParser.json()); // connect middleware that parses json
app.use(bodyParser.urlencoded({ extended: false })); // connect middleware that parses urlencoded bodies


app.get('/', (req, res) => { // define a handler for default page
  try {
    req.DocManager = new DocManager(req, res);

    res.render('index', { // render index template with the parameters specified
      preloaderUrl: siteUrl + configServer.get('preloaderUrl'),
      convertExts: configServer.get('convertedDocs'),
      editedExts: configServer.get('editedDocs'),
      fillExts: configServer.get('fillDocs'),
      storedFiles: req.DocManager.getStoredFiles(),
      params: req.DocManager.getCustomParams(),
      users,
      serverUrl: req.DocManager.getServerUrl(),
      languages: configServer.get('languages'),
    });
  } catch (ex) {
    console.log(ex); // display error message in the console
    res.status(500); // write status parameter to the response
    res.render('error', { message: 'Server error' }); // render error template with the message parameter specified
    return;
  }
});

app.get('/download', (req, res) => { // define a handler for downloading files
  req.DocManager = new DocManager(req, res);

  let fileName = fileUtility.getFileName(req.query.fileName);
  let userAddress = req.query.useraddress;
  let token = '';

  if (!!userAddress
        && cfgSignatureEnable && cfgSignatureUseForRequest) {
    let authorization = req.get(cfgSignatureAuthorizationHeader);
    if (authorization && authorization.startsWith(cfgSignatureAuthorizationHeaderPrefix)) {
      token = authorization.substring(cfgSignatureAuthorizationHeaderPrefix.length);
    }

    try {
      jwt.verify(token, cfgSignatureSecret);
    } catch (err) {
      console.log(`checkJwtHeader error: name = ${err.name} message = ${err.message} token = ${token}`)
      res.sendStatus(403);
      return;
    }
  }

  // get the path to the force saved document version
  let path = req.DocManager.forcesavePath(fileName, userAddress, false);
  if (path == '') {
    path = req.DocManager.storagePath(fileName, userAddress); // or to the original document
  }

  // add headers to the response to specify the page parameters
  res.setHeader('Content-Length', fileSystem.statSync(path).size);
  res.setHeader('Content-Type', mime.getType(path));

  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);

  let filestream = fileSystem.createReadStream(path);
  filestream.pipe(res); // send file information to the response by streams
});

app.get('/history', (req, res) => {
  req.DocManager = new DocManager(req, res);
  if (cfgSignatureEnable && cfgSignatureUseForRequest) {
    let authorization = req.get(cfgSignatureAuthorizationHeader);
    if (authorization && authorization.startsWith(cfgSignatureAuthorizationHeaderPrefix)) {
      let token = authorization.substring(cfgSignatureAuthorizationHeaderPrefix.length);
      try {
        jwt.verify(token, cfgSignatureSecret);
      } catch (err) {
        console.log(`checkJwtHeader error: name = ${err.name} message = ${err.message} token = ${token}`);
        res.sendStatus(403);
        return;
      }
    } else {
      res.sendStatus(403);
      return;
    }
  }

  let {fileName} = req.query;
  let userAddress = req.query.useraddress;
  let {ver} = req.query;
  let {file} = req.query;
  let Path = '';

  if (file.includes('diff')) {
    Path = req.DocManager.diffPath(fileName, userAddress, ver);
  } else if (file.includes('prev')) {
    Path = req.DocManager.prevFilePath(fileName, userAddress, ver);
  } else {
    res.sendStatus(403);
    return;
  }

  // add headers to the response to specify the page parameters
  res.setHeader('Content-Length', fileSystem.statSync(Path).size);
  res.setHeader('Content-Type', mime.getType(Path));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file)}`);

  let filestream = fileSystem.createReadStream(Path);
  filestream.pipe(res); // send file information to the response by streams
})

app.post('/upload', (req, res) => { // define a handler for uploading files
  req.DocManager = new DocManager(req, res);
  req.DocManager.storagePath(''); // mkdir if not exist

  const userIp = req.DocManager.curUserHostAddress(); // get the path to the user host
  const uploadDir = req.DocManager.storageRootPath(userIp);
  const uploadDirTmp = path.join(uploadDir, 'tmp'); // and create directory for temporary files if it doesn't exist
  req.DocManager.createDirectory(uploadDirTmp);

  const form = new formidable.IncomingForm(); // create a new incoming form
  form.uploadDir = uploadDirTmp; // and write there all the necessary parameters
  form.keepExtensions = true;

  form.parse(req, (err, fields, files) => { // parse this form
    	if (err) { // if an error occurs
      // DocManager.cleanFolderRecursive(uploadDirTmp, true);  // clean the folder with temporary files
      res.writeHead(200, { 'Content-Type': 'text/plain' }); // and write the error status and message to the response
      res.write(`{ "error": "${err.message}"}`);
      res.end();
      return;
    }

    const file = files.uploadedFile;

    if (file == undefined) { // if file parameter is undefined
      res.writeHead(200, { 'Content-Type': 'text/plain' }); // write the error status and message to the response
      res.write('{ "error": "Uploaded file not found"}');
      res.end();
      return;
    }

    file.name = req.DocManager.getCorrectName(file.name);

    // check if the file size exceeds the maximum file size
    if (configServer.get('maxFileSize') < file.size || file.size <= 0) {
      // DocManager.cleanFolderRecursive(uploadDirTmp, true);  // clean the folder with temporary files
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('{ "error": "File size is incorrect"}');
      res.end();
      return;
    }

    const exts = [].concat(
      configServer.get('viewedDocs'),configServer.get('editedDocs'),
      configServer.get('convertedDocs'), configServer.get('fillDocs')
    ); // all the supported file extensions
    const curExt = fileUtility.getFileExtension(file.name);
    const documentType = fileUtility.getFileType(file.name);

    if (exts.indexOf(curExt) == -1) { // check if the file extension is supported
      // DocManager.cleanFolderRecursive(uploadDirTmp, true);  // if not, clean the folder with temporary files
      res.writeHead(200, { 'Content-Type': 'text/plain' }); // and write the error status and message to the response
      res.write('{ "error": "File type is not supported"}');
      res.end();
      return;
    }

    fileSystem.rename(file.path, `${uploadDir}/${file.name}`, (err) => { // rename a file
      // DocManager.cleanFolderRecursive(uploadDirTmp, true);  // clean the folder with temporary files
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      if (err) { // if an error occurs
        res.write(`{ "error": "${err}"}`); // write an error message to the response
      } else {
        // otherwise, write a new file name to the response
        res.write(`{ "filename": "${file.name}", "documentType": "${documentType}" }`);

        let user = users.getUser(req.query.userid); // get user id and name parameters or set them to the default values

        req.DocManager.saveFileData(file.name, user.id, user.name);
      }
      res.end();
    });
  });
});

app.post('/create', (req, res) => {
  let {title} = req.body;
  let fileUrl = req.body.url;

  try {
    req.DocManager = new DocManager(req, res);
    req.DocManager.storagePath(''); // mkdir if not exist

    let fileName = req.DocManager.getCorrectName(title);
    let userAddress = req.DocManager.curUserHostAddress();
    req.DocManager.historyPath(fileName, userAddress, true);

    urllib.request(fileUrl, {method: 'GET'},(err, data) => {
      // check if the file size exceeds the maximum file size
      if (configServer.get('maxFileSize') < data.length || data.length <= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write(JSON.stringify({ error: 'File size is incorrect' }));
        res.end();
        return;
      }

      const exts = [].concat(
        configServer.get('viewedDocs'), configServer.get('editedDocs'),
        configServer.get('convertedDocs'), configServer.get('fillDocs')
      ); // all the supported file extensions
      const curExt = fileUtility.getFileExtension(fileName);

      if (exts.indexOf(curExt) == -1) { // check if the file extension is supported
        // and write the error status and message to the response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write(JSON.stringify({ error: 'File type is not supported' }));
        res.end();
        return;
      }

      fileSystem.writeFileSync(req.DocManager.storagePath(fileName), data);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(JSON.stringify({ file : fileName }));
      res.end();
    });
  } catch (e) {
    res.status(500);
    res.write(JSON.stringify({
      error: 1,
      message: e.message
    }));
    res.end();
  }
});

app.post('/convert', (req, res) => { // define a handler for converting files
  req.DocManager = new DocManager(req, res);

  let fileName = fileUtility.getFileName(req.body.filename);
  let filePass = req.body.filePass ? req.body.filePass : null;
  let lang = req.body.lang ? req.body.lang : null;
  let fileUri = req.DocManager.getDownloadUrl(fileName, true);
  let fileExt = fileUtility.getFileExtension(fileName);
  let internalFileExt = 'ooxml';
  let response = res;

  let writeResult = function (filename, step, error) {
    let result = {};

    // write file name, step and error values to the result object if they are defined
    if (filename != null) result.filename = filename;

    if (step != null) result.step = step;

    if (error != null) result.error = error;

    response.setHeader('Content-Type', 'application/json');
    response.write(JSON.stringify(result));
    response.end();
  };

  let callback = async function (err, res) {
    if (err) { // if an error occurs
      // check what type of error it is
      if (err.name === 'ConnectionTimeoutError' || err.name === 'ResponseTimeoutError') {
        writeResult(fileName, 0, null); // despite the timeout errors, write the file to the result object
      } else {
        writeResult(null, null, JSON.stringify(err)); // other errors trigger an error message
      }
      return;
    }

    try {
      let responseData = documentService.getResponseUri(res.toString());
      let result = responseData.percent;
      let newFileUri = responseData.uri; // get the callback url
      let newFileType = `.${responseData.fileType}`; // get the file type

      if (result != 100) { // if the status isn't 100
        writeResult(fileName, result, null); // write the origin file to the result object
        return;
      }

      // get the file name with a new extension
      let correctName = req.DocManager.getCorrectName(fileUtility.getFileName(fileName, true) + newFileType);

      const {status, data} = await urllib.request(newFileUri, {method: 'GET'});

      if (status != 200) throw new Error(`Conversion service returned status: ${status}`);

      // write a file with a new extension, but with the content from the origin file
      fileSystem.writeFileSync(req.DocManager.storagePath(correctName), data);
      fileSystem.unlinkSync(req.DocManager.storagePath(fileName)); // remove file with the origin extension

      let userAddress = req.DocManager.curUserHostAddress();
      let historyPath = req.DocManager.historyPath(fileName, userAddress, true);
      // get the history path to the file with a new extension
      let correctHistoryPath = req.DocManager.historyPath(correctName, userAddress, true);

      fileSystem.renameSync(historyPath, correctHistoryPath); // change the previous history path

      fileSystem.renameSync(
        path.join(correctHistoryPath, `${fileName}.txt`),
        path.join(correctHistoryPath, `${correctName}.txt`)
      ); // change the name of the .txt file with document information

      writeResult(correctName, result, null); // write a file with a new name to the result object
    } catch (e) {
      console.log(e); // display error message in the console
      writeResult(null, null, e.message);
    }
  };

  try {
    // check if the file with such an extension can be converted
    if (configServer.get('convertedDocs').indexOf(fileExt) != -1) {
      const storagePath = req.DocManager.storagePath(fileName);
      const stat = fileSystem.statSync(storagePath);
      let key = fileUri + stat.mtime.getTime();

      key = documentService.generateRevisionId(key); // get document key
      // get the url to the converted file
      documentService.getConvertedUri(fileUri, fileExt, internalFileExt, key, true, callback, filePass, lang);
    } else {
      // if the file with such an extension can't be converted, write the origin file to the result object
      writeResult(fileName, null, null);
    }
  } catch (ex) {
    console.log(ex);
    writeResult(null, null, 'Server error');
  }
});

app.get('/files', (req, res) => { // define a handler for getting files information
  try {
    req.DocManager = new DocManager(req, res);
    // get the information about the files from the storage path
    const filesInDirectoryInfo = req.DocManager.getFilesInfo();
    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify(filesInDirectoryInfo)); // transform files information into the json string
  } catch (ex) {
    console.log(ex);
    res.write('Server error');
  }
  res.end();
});

app.get('/files/file/:fileId', (req, res) => { // define a handler for getting file information by its id
  try {
    req.DocManager = new DocManager(req, res);
    const {fileId} = req.params;
    // get the information about the file specified by a file id
    const fileInfoById = req.DocManager.getFilesInfo(fileId);
    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify(fileInfoById));
  } catch (ex) {
    console.log(ex);
    res.write('Server error');
  }
  res.end();
});

app.delete('/file', (req, res) => { // define a handler for removing file
  try {
    	req.DocManager = new DocManager(req, res);
    let fileName = req.query.filename;
    if (fileName) { // if the file name is defined
      fileName = fileUtility.getFileName(fileName); // get its part without an extension

      req.DocManager.fileRemove(fileName); // delete file and his history
    } else {
      // if the file name is undefined, clean the storage folder
      req.DocManager.cleanFolderRecursive(req.DocManager.storagePath(''), false);
    }

    res.write('{"success":true}');
  } catch (ex) {
    console.log(ex);
    res.write('Server error');
  }
  res.end();
});

app.get('/csv', (req, res) => { // define a handler for downloading csv files
  let fileName = 'csv.csv';
  let csvPath = path.join(__dirname, 'public', 'assets', 'sample', fileName);

  // add headers to the response to specify the page parameters
  res.setHeader('Content-Length', fileSystem.statSync(csvPath).size);
  res.setHeader('Content-Type', mime.getType(csvPath));

  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);

  let filestream = fileSystem.createReadStream(csvPath);
  filestream.pipe(res); // send file information to the response by streams
})

app.post('/reference', (req, res) => { // define a handler for renaming file
  req.DocManager = new DocManager(req, res);

  let result = function (data) {
    res.writeHead(200, {'Content-Type': 'application/json' });
    res.write(JSON.stringify(data));
    res.end();
  };

  let {referenceData} = req.body;
  let fileName = '';
  if (!!referenceData) {
    let {instanceId} = referenceData;

    if (instanceId === req.DocManager.getInstanceId()) {
      let fileKey = JSON.parse(referenceData.fileKey);
      const {userAddress} = fileKey;

      if (userAddress === req.DocManager.curUserHostAddress()
                && req.DocManager.existsSync(req.DocManager.storagePath(fileKey.fileName, userAddress))) {
        ({fileName} = fileKey);
      }
    }
  }

  if (!fileName && !!req.body.path) {
    let path = fileUtility.getFileName(req.body.path);

    if (req.DocManager.existsSync(req.DocManager.storagePath(path, userAddress))) {
      fileName = path;
    }
  }

  if (!fileName) {
    result({ error: 'File is not found' });
    return;
  }

  let data = {
    fileType: fileUtility.getFileExtension(fileName).slice(1),
    url: req.DocManager.getDownloadUrl(fileName, true),
    directUrl: req.body.directUrl ? req.DocManager.getDownloadUrl(fileName) : null,
    referenceData: {
      fileKey: JSON.stringify({ fileName, userAddress: req.DocManager.curUserHostAddress()}),
      instanceId: req.DocManager.getServerUrl()
    },
    path: fileName,
  };

  if (cfgSignatureEnable) {
    // sign token with given data using signature secret
    data.token = jwt.sign(data, cfgSignatureSecret, {expiresIn: cfgSignatureSecretExpiresIn});
  }

  result(data);
});

app.post('/track', async (req, res) => { // define a handler for tracking file changes
  req.DocManager = new DocManager(req, res);

  let userAddress = req.query.useraddress;
  let fileName = fileUtility.getFileName(req.query.filename);
  let version = 0;

  // track file changes
  let processTrack = async function (response, body, fileName, userAddress) {
    // callback file saving process
    let callbackProcessSave = async function (downloadUri, body, fileName, userAddress, newFileName) {
      try {
        const {status, data} = await urllib.request(downloadUri, {method: 'GET'});

        if (status != 200) throw new Error(`Document editing service returned status: ${status}`);

        let storagePath = req.DocManager.storagePath(newFileName, userAddress);

        let historyPath = req.DocManager.historyPath(newFileName, userAddress); // get the path to the history data
        if (historyPath == '') { // if the history path doesn't exist
          historyPath = req.DocManager.historyPath(newFileName, userAddress, true); // create it
          req.DocManager.createDirectory(historyPath); // and create a directory for the history data
        }

        let count_version = req.DocManager.countVersion(historyPath); // get the next file version number
        version = count_version + 1;
        // get the path to the specified file version
        let versionPath = req.DocManager.versionPath(newFileName, userAddress, version);
        req.DocManager.createDirectory(versionPath); // create a directory to the specified file version

        let downloadZip = body.changesurl;
        if (downloadZip) {
          // get the path to the file with document versions differences
          let path_changes = req.DocManager.diffPath(newFileName, userAddress, version);
          const {status, data} = await urllib.request(downloadZip, {method: 'GET'});
          if (status == 200) {
            fileSystem.writeFileSync(path_changes, data); // write the document version differences to the archive
          } else {
            emitWarning(`Document editing service returned status: ${status}`);
          }
        }

        let changeshistory = body.changeshistory || JSON.stringify(body.history);
        if (changeshistory) {
          // get the path to the file with document changes
          let path_changes_json = req.DocManager.changesPath(newFileName, userAddress, version);
          fileSystem.writeFileSync(path_changes_json, changeshistory); // and write this data to the path in json format
        }

        let path_key = req.DocManager.keyPath(newFileName, userAddress, version); // get the path to the key.txt file
        fileSystem.writeFileSync(path_key, body.key); // write the key value to the key.txt file

        // get the path to the previous file version
        let path_prev = path.join(versionPath, `prev${fileUtility.getFileExtension(fileName)}`);
        // and write it to the current path
        fileSystem.renameSync(req.DocManager.storagePath(fileName, userAddress), path_prev);

        fileSystem.writeFileSync(storagePath, data);

        // get the path to the forcesaved file
        let forcesavePath = req.DocManager.forcesavePath(newFileName, userAddress, false);
        if (forcesavePath != '') { // if this path is empty
          fileSystem.unlinkSync(forcesavePath); // remove it
        }
      } catch (ex) {
        console.log(ex);
        response.write('{"error":1}');
        response.end();
        return;
      }

      response.write('{"error":0}');
      response.end();
    }

    // file saving process
    let processSave = async function (downloadUri, body, fileName, userAddress) {
      if (!downloadUri) {
        response.write('{"error":1}');
        response.end();
        return;
      }

      let curExt = fileUtility.getFileExtension(fileName); // get current file extension
      let downloadExt = `.${body.filetype}`; // get the extension of the downloaded file

      let newFileName = fileName;

      // convert downloaded file to the file with the current extension if these extensions aren't equal
      if (downloadExt != curExt) {
        let key = documentService.generateRevisionId(downloadUri);
        // get the correct file name if it already exists
        newFileName = req.DocManager.getCorrectName(fileUtility.getFileName(fileName, true) + downloadExt, userAddress);
        try {
          documentService.getConvertedUriSync(downloadUri, downloadExt, curExt, key, async (err, data) => {
            if (err) {
              await callbackProcessSave(downloadUri, body, fileName, userAddress, newFileName);
              return;
            }
            try {
              let res = documentService.getResponseUri(data);
              await callbackProcessSave(res.uri, body, fileName, userAddress, fileName);
              return;
            } catch (ex) {
              console.log(ex);
              await callbackProcessSave(downloadUri, body, fileName, userAddress, newFileName);
              return;
            }
          });
          return;
        } catch (ex) {
          console.log(ex);
        }
      }
      await callbackProcessSave(downloadUri, body, fileName, userAddress, newFileName);
    };

    // callback file force saving process
    let callbackProcessForceSave = async function (downloadUri, body, fileName, userAddress, newFileName = false) {
      try {
        const {status, data} = await urllib.request(downloadUri, {method: 'GET'});

        if (status != 200) throw new Error(`Document editing service returned status: ${status}`);

        let downloadExt = `.${body.fileType}`;
        let isSubmitForm = body.forcesavetype === 3; // SubmitForm
        let correctName = '';
        let forcesavePath = '';

        if (isSubmitForm) {
          // new file
          if (newFileName) {
            correctName = req.DocManager.getCorrectName(`${fileUtility.getFileName(fileName, true)}
            -form${downloadExt}`, userAddress);
          } else {
            let ext = fileUtility.getFileExtension(fileName);
            correctName = req.DocManager.getCorrectName(`${fileUtility.getFileName(fileName, true)}
            -form${ext}`, userAddress);
          }
          forcesavePath = req.DocManager.storagePath(correctName, userAddress);
        } else {
          if (newFileName) {
            correctName = req.DocManager.getCorrectName
            (fileUtility.getFileName(fileName, true) + downloadExt, userAddress);
          }
          // create forcesave path if it doesn't exist
          let forcesavePath = req.DocManager.forcesavePath(correctName, userAddress, false);
          if (forcesavePath == '') {
            forcesavePath = req.DocManager.forcesavePath(correctName, userAddress, true);
          }
        }

        fileSystem.writeFileSync(forcesavePath, data);

        if (isSubmitForm) {
          let uid = body.actions[0].userid
          req.DocManager.saveFileData(correctName, uid, 'Filling Form', userAddress);
        }
      } catch (ex) {
        response.write('{"error":1}');
        response.end();
        return;
      }

      response.write('{"error":0}');
      response.end();
    }

    // file force saving process
    let processForceSave = async function (downloadUri, body, fileName, userAddress) {
      if (!downloadUri) {
        response.write('{"error":1}');
        response.end();
        return;
      }

      let curExt = fileUtility.getFileExtension(fileName);
      let downloadExt = `.${body.filetype}`;

      // convert downloaded file to the file with the current extension if these extensions aren't equal
      if (downloadExt != curExt) {
        let key = documentService.generateRevisionId(downloadUri);
        try {
          documentService.getConvertedUriSync(downloadUri, downloadExt, curExt, key, async (err, data) => {
            if (err) {
              await callbackProcessForceSave(downloadUri, body, fileName, userAddress, true);
              return;
            }
            try {
              let res = documentService.getResponseUri(data);
              await callbackProcessForceSave(res.uri, body, fileName, userAddress, false);
              return;
            } catch (ex) {
              console.log(ex);
              await callbackProcessForceSave(downloadUri, body, fileName, userAddress, true);
              return;
            }
          });
          return;
        } catch (ex) {
          console.log(ex);
        }
      }
      await callbackProcessForceSave (downloadUri, body, fileName, userAddress, false);
    };

    if (body.status == 1) { // editing
      if (body.actions && body.actions[0].type == 0) { // finished edit
        let user = body.actions[0].userid;
        if (body.users.indexOf(user) == -1) {
          let {key} = body;
          try {
            documentService.commandRequest('forcesave', key); // call the forcesave command
          } catch (ex) {
            console.log(ex);
          }
        }
      }
    } else if (body.status == 2 || body.status == 3) { // MustSave, Corrupted
      await processSave(body.url, body, fileName, userAddress); // save file
      return;
    } else if (body.status == 6 || body.status == 7) { // MustForceSave, CorruptedForceSave
      await processForceSave(body.url, body, fileName, userAddress); // force save file
      return;
    }

    response.write('{"error":0}');
    response.end();
  };

  // read request body
  let readbody = async function (request, response, fileName, userAddress) {
    let content = '';
    request.on('data', async (data) => { // get data from the request
      content += data;
    });
    request.on('end', async () => {
      let body = JSON.parse(content);
      await processTrack(response, body, fileName, userAddress); // and track file changes
    });
  };

  // check jwt token
  if (cfgSignatureEnable && cfgSignatureUseForRequest) {
    let body = null;
    if (req.body.hasOwnProperty('token')) { // if request body has its own token
      body = documentService.readToken(req.body.token); // read and verify it
    } else {
      let checkJwtHeaderRes = documentService.checkJwtHeader(req); // otherwise, check jwt token headers
      if (checkJwtHeaderRes) { // if they exist
        if (checkJwtHeaderRes.payload) {
          body = checkJwtHeaderRes.payload; // get the payload object
        }
        // get user address and file name from the query
        if (checkJwtHeaderRes.query) {
          if (checkJwtHeaderRes.query.useraddress) {
            userAddress = checkJwtHeaderRes.query.useraddress;
          }
          if (checkJwtHeaderRes.query.filename) {
            fileName = fileUtility.getFileName(checkJwtHeaderRes.query.filename);
          }
        }
      }
    }
    if (body == null) {
      res.write('{"error":1}');
      res.end();
      return;
    }
    await processTrack(res, body, fileName, userAddress);
    return;
  }

  if (req.body.hasOwnProperty('status')) { // if the request body has status parameter
    await processTrack(res, req.body, fileName, userAddress); // track file changes
  } else {
    await readbody(req, res, fileName, userAddress); // otherwise, read request body first
  }
});

app.get('/editor', (req, res) => { // define a handler for editing document
  try {
    req.DocManager = new DocManager(req, res);

    let fileName = fileUtility.getFileName(req.query.fileName);
    let {fileExt} = req.query;
    let history = [];
    let historyData = [];
    let lang = req.DocManager.getLang();
    let user = users.getUser(req.query.userid);
    let userDirectUrl = req.query.directUrl == 'true';

    let userid = user.id;
    let {name} = user;

    let actionData = 'null';
    if (req.query.action) {
      try {
        actionData = JSON.stringify(JSON.parse(req.query.action));
      } catch (ex) {
        console.log(ex);
      }
    }

    let type = req.query.type || ''; // type: embedded/mobile/desktop
    if (type == '') {
      type = new RegExp(configServer.get('mobileRegEx'), 'i').test(req.get('User-Agent')) ? 'mobile' : 'desktop';
    } else if (type != 'mobile'
            && type != 'embedded') {
      type = 'desktop';
    }

    let templatesImageUrl = req.DocManager.getTemplateImageUrl(fileUtility.getFileType(fileName));
    let createUrl = req.DocManager.getCreateUrl(fileUtility.getFileType(fileName), userid, type, lang);
    let templates = [
      {
        image: '',
        title: 'Blank',
        url: createUrl
      },
      {
        image: templatesImageUrl,
        title: 'With sample content',
        url: `${createUrl}&sample=true`
      }
    ];

    let userGroup = user.group;
    let {reviewGroups} = user;
    let {commentGroups} = user;
    let {userInfoGroups} = user;

    if (fileExt != null) {
      // create demo document of a given extension
      let fileName = req.DocManager.createDemo(!!req.query.sample, fileExt, userid, name, false);

      // get the redirect path
      let redirectPath = `${req.DocManager.getServerUrl()}/editor?fileName=`
      + `${encodeURIComponent(fileName)}${req.DocManager.getCustomParams()}`;
      res.redirect(redirectPath);
      return;
    }
    fileExt = fileUtility.getFileExtension(fileName);

    let userAddress = req.DocManager.curUserHostAddress();
    // if the file with a given name doesn't exist
    if (!req.DocManager.existsSync(req.DocManager.storagePath(fileName, userAddress))) {
      throw {
        message: `File not found: ${fileName}` // display error message
      };
    }
    let key = req.DocManager.getKey(fileName);
    let url = req.DocManager.getDownloadUrl(fileName, true);
    let directUrl = req.DocManager.getDownloadUrl(fileName);
    let mode = req.query.mode || 'edit'; // mode: view/edit/review/comment/fillForms/embedded

    let canEdit = configServer.get('editedDocs').indexOf(fileExt) != -1; // check if this file can be edited
    if ((!canEdit && mode == 'edit' || mode == 'fillForms') && configServer.get('fillDocs').indexOf(fileExt) != -1) {
      mode = 'fillForms';
      canEdit = true;
    }
    if (!canEdit && mode == 'edit') {
      mode = 'view';
    }
    let submitForm = mode == 'fillForms' && userid == 'uid-1' && !1;

    let countVersion = 1;

    let historyPath = req.DocManager.historyPath(fileName, userAddress);
    let changes = null;
    let keyVersion = key;

    if (historyPath != '') {
      countVersion = req.DocManager.countVersion(historyPath) + 1; // get the number of file versions
      for (let i = 1; i <= countVersion; i += 1) { // get keys to all the file versions
        if (i < countVersion) {
          let keyPath = req.DocManager.keyPath(fileName, userAddress, i);
          if (!fileSystem.existsSync(keyPath)) continue;
          keyVersion = `${fileSystem.readFileSync(keyPath)}`;
        } else {
          keyVersion = key;
        }
        // write all the file history information
        history.push(req.DocManager.getHistory(fileName, changes, keyVersion, i));

        let userUrl = i == countVersion ? directUrl : (`${req.DocManager.getServerUrl(false)}/history?fileName=`
        + `${encodeURIComponent(fileName)}&file=prev${fileExt}&ver=${i}`);
        let historyD = {
          fileType: fileExt.slice(1),
          version: i,
          key: keyVersion,
          url: i == countVersion ? url : (`${req.DocManager.getServerUrl(true)}/history?fileName=`
          + `${encodeURIComponent(fileName)}&file=prev${fileExt}&ver=${i}&useraddress=${userAddress}`),
          directUrl: !userDirectUrl ? null : userUrl,
        };

        // check if the path to the file with document versions differences exists
        if (i > 1 && req.DocManager.existsSync(req.DocManager.diffPath(fileName, userAddress, i - 1))) {
          historyD.previous = { // write information about previous file version
            fileType: historyData[i - 2].fileType,
            key: historyData[i - 2].key,
            url: historyData[i - 2].url,
            directUrl: !userDirectUrl ? null : historyData[i - 2].directUrl,
          };
          const changesUrl = `${req.DocManager.getServerUrl(true)}/history?fileName=`
          + `${encodeURIComponent(fileName)}&file=diff.zip&ver=${i - 1}&useraddress=${userAddress}`;
          historyD.changesUrl = changesUrl; // get the path to the diff.zip file and write it to the history object
        }

        historyData.push(historyD);

        if (i < countVersion) {
          // get the path to the file with document changes
          let changesFile = req.DocManager.changesPath(fileName, userAddress, i);
          changes = req.DocManager.getChanges(changesFile); // get changes made in the file
        }
      }
    } else { // if history path is empty
      // write the history information about the last file version
      history.push(req.DocManager.getHistory(fileName, changes, keyVersion, countVersion));
      historyData.push({
        fileType: fileExt.slice(1),
        version: countVersion,
        key,
        url,
        directUrl: !userDirectUrl ? null : directUrl,
      });
    }

    if (cfgSignatureEnable) {
      for (let i = 0; i < historyData.length; i += 1) {
        // sign token with given data using signature secret
        historyData[i].token = jwt.sign(historyData[i], cfgSignatureSecret, {expiresIn: cfgSignatureSecretExpiresIn});
      }
    }

    // file config data
    let argss = {
      apiUrl: siteUrl + configServer.get('apiUrl'),
      file: {
        name: fileName,
        ext: fileUtility.getFileExtension(fileName, true),
        uri: url,
        directUrl: !userDirectUrl ? null : directUrl,
        uriUser: directUrl,
        version: countVersion,
        created: new Date().toDateString(),
        favorite: user.favorite != null ? user.favorite : 'null'
      },
      editor: {
        type,
        documentType: fileUtility.getFileType(fileName),
        key,
        token: '',
        callbackUrl: req.DocManager.getCallback(fileName),
        createUrl: userid != 'uid-0' ? createUrl : null,
        templates: user.templates ? templates : null,
        isEdit: canEdit && (mode == 'edit' || mode == 'view' || mode == 'filter' || mode == 'blockcontent'),
        review: canEdit && (mode == 'edit' || mode == 'review'),
        chat: userid != 'uid-0',
        coEditing: mode == 'view' && userid == 'uid-0' ? {mode: 'strict', change: false} : null,
        comment: mode != 'view' && mode != 'fillForms' && mode != 'embedded' && mode != 'blockcontent',
        fillForms: mode != 'view' && mode != 'comment' && mode != 'embedded' && mode != 'blockcontent',
        modifyFilter: mode != 'filter',
        modifyContentControl: mode != 'blockcontent',
        copy: !user.deniedPermissions.includes('copy'),
        download: !user.deniedPermissions.includes('download'),
        print: !user.deniedPermissions.includes('print'),
        mode: mode != 'view' ? 'edit' : 'view',
        canBackToFolder: type != 'embedded',
        backUrl: `${req.DocManager.getServerUrl()}/`,
        curUserHostAddress: req.DocManager.curUserHostAddress(),
        lang,
        userid: userid != 'uid-0' ? userid : null,
        name,
        userGroup,
        reviewGroups: JSON.stringify(reviewGroups),
        commentGroups: JSON.stringify(commentGroups),
        userInfoGroups: JSON.stringify(userInfoGroups),
        fileChoiceUrl,
        submitForm,
        plugins: JSON.stringify(plugins),
        actionData,
        fileKey: userid != 'uid-0' ? JSON.stringify
        ({ fileName, userAddress: req.DocManager.curUserHostAddress()}) : null,
        instanceId: userid != 'uid-0' ? req.DocManager.getInstanceId() : null,
        protect: !user.deniedPermissions.includes('protect')
      },
      history,
      historyData,
      dataInsertImage: {
        fileType: 'png',
        url: `${req.DocManager.getServerUrl(true)}/images/logo.png`,
        directUrl: !userDirectUrl ? null : `${req.DocManager.getServerUrl()}/images/logo.png`,
      },
      dataCompareFile: {
        fileType: 'docx',
        url: `${req.DocManager.getServerUrl(true)}/assets/sample/sample.docx`,
        directUrl: !userDirectUrl ? null : `${req.DocManager.getServerUrl()}/assets/sample/sample.docx`,
      },
      dataMailMergeRecipients: {
        fileType: 'csv',
        url: `${req.DocManager.getServerUrl(true)}/csv`,
        directUrl: !userDirectUrl ? null : `${req.DocManager.getServerUrl()}/csv`,
      },
      usersForMentions: user.id != 'uid-0' ? users.getUsersForMentions(user.id) : null,
    };

    if (cfgSignatureEnable) {
      app.render('config', argss, (err, html) => { // render a config template with the parameters specified
        if (err) {
          console.log(err);
        } else {
          // sign token with given data using signature secret
          argss.editor.token = jwt.sign
          (JSON.parse(`{${html}}`), cfgSignatureSecret, {expiresIn: cfgSignatureSecretExpiresIn});
          argss.dataInsertImage.token = jwt.sign
          (argss.dataInsertImage, cfgSignatureSecret, {expiresIn: cfgSignatureSecretExpiresIn});
          argss.dataCompareFile.token = jwt.sign
          (argss.dataCompareFile, cfgSignatureSecret, {expiresIn: cfgSignatureSecretExpiresIn});
          argss.dataMailMergeRecipients.token = jwt.sign
          (argss.dataMailMergeRecipients, cfgSignatureSecret, {expiresIn: cfgSignatureSecretExpiresIn});
        }
        res.render('editor', argss); // render the editor template with the parameters specified
      });
    } else {
      res.render('editor', argss);
    }
  } catch (ex) {
    console.log(ex);
    res.status(500);
    res.render('error', { message: `Server error: ${ex.message}` });
  }
});

app.post('/rename', (req, res) => { // define a handler for renaming file
  let {newfilename} = req.body;
  let origExt = req.body.ext;
  let curExt = fileUtility.getFileExtension(newfilename, true);
  if (curExt !== origExt) {
    newfilename += `.${origExt}`;
  }

  let {dockey} = req.body;
  let meta = {title: newfilename};

  let result = function (err, data, ress) {
    res.writeHead(200, {'Content-Type': 'application/json' });
    res.write(JSON.stringify({ result: ress }));
    res.end();
  };

  documentService.commandRequest('meta', dockey, meta, result);
});

wopiApp.registerRoutes(app);

// "Not found" error with 404 status
app.use((req, res, next) => {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// render the error template with the parameters specified
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message
  });
});

// save all the functions to the app module to export it later in other files
module.exports = app;
