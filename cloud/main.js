/**
 * Validate user, call Facebook API for more information
 */
 Parse.Cloud.beforeSave(Parse.User, function(request, response) {
  if (!request.object.existed()) {
    var user  = request.object;
    var fb    = user.get('authData').facebook;

    Parse.Cloud.httpRequest({
      method: 'GET',
      url: 'https://graph.facebook.com/' + fb.id,
      params: {
        access_token: fb.access_token
      }
    }).then(function(httpResponse) {
      var data = httpResponse.data;

      user.set('name', data.name);
      user.set('photo', 'https://graph.facebook.com/' + fb.id + '/picture');
      user.set('requestsLimit', 3);
      user.set('has', []);
      user.set('hasNot', []);

      response.success();
    }, response.error);
  } else {
    response.success();
  }
});

/**
 * Make a request
 *
 * @param {string} item Name of the item
 *
 * @response {Parse.Object} request
 */
Parse.Cloud.define('request', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var user      = request.user;
  var itemName  = request.params.item;

  // Verify if user can request
  if (user.get('requestsLimit') <= 0) {
    return response.error('User cannot request');
  }

  // Query item
  var item  = new Parse.Object('Item');
  var query = new Parse.Query('Item');

  query.equalTo('nameLowercase', itemName.toLowerCase());

  // Item exists? If not, create it
  query.first().then(function(result) {
    if (result) {
      item = result;
      return Parse.Promise.as(item);
    } else {
      // Capitalize item name
      itemName = itemName.charAt(0).toUpperCase() + itemName.slice(1);

      item.set('name', itemName);
      item.set('nameLowercase', itemName.toLowerCase());

      return item.save();
    }
  }).then(function(item) {
    // Create request
    var req = new Parse.Object('Request');
    var acl = new Parse.ACL();

    acl.setPublicReadAccess(true);
    acl.setPublicWriteAccess(false);
    acl.setWriteAccess(user, true);

    req.setACL(acl);
    req.set('author', user);
    req.set('item', item);
    req.set('dealing', false);
    req.set('closed', false);
    req.set('expired', false);

    return req.save();
  }).then(function(req) {
    // Decrement requests limit from user
    user.increment('requestsLimit', -1);
    user.save();

    response.success(req);
  }, response.error);
});

/**
 * Get requests
 *
 * @param {int} [limit=30]
 * @param {int} [page=1]
 *
 * @todo Order requests by user's gender, course and inventory.
 *
 * @response {Parse.Object[]} List of request objects
 */
Parse.Cloud.define('getRequests', function(request, response) {
  // Params
  //var location = request.user.get('location');
  //var has = request.user.get('has');
  //var hasNot = request.user.get('hasNot');
  var location  = false;
  var limit     = request.params.limit || 30;
  var page      = request.params.page || 1;

  // Query
  var query = new Parse.Query('Request');
  query.equalTo('dealing', false);
  query.equalTo('closed', false);
  query.equalTo('expired', false);
  query.include(['author', 'item']);
  query.limit(limit);
  query.skip((page - 1) * limit);

  if (location) {
    query.near('author.location').then(response.success, response.error);
  } else {
    query.descending('createdAt');
    query.find().then(response.success, response.error);
  }
});

/**
 * Get user's requests
 *
 * @param {int} [limit=30]
 * @param {int} [page=1]
 *
 * @todo Archive old requests
 *
 * @response {array} List of request objects
 */
Parse.Cloud.define('getUserRequests', function(request, response) {
  // Params
  var limit = request.params.limit || 30;
  var page  = request.params.page || 1;

  // query
  var query = new Parse.Query('Request');
  query.equalTo('author', request.user);
  query.include(['author', 'helper', 'item']);
  query.descending('createdAt');
  query.limit(limit);
  query.skip((page - 1) * limit);

  query.find().then(response.success, response.error);
});

/**
 * Get user's in progress requests
 *
 * @param {int} [limit=30]
 * @param {int} [page=1]
 *
 * @todo Archive old requests
 *
 * @response {array} List of request objects
 */
Parse.Cloud.define('getDealingRequests', function(request, response) {
  // Params
  var limit = request.params.limit || 30;
  var page  = request.params.page || 1;

  // Query
  var isHelper = new Parse.Query('Request');
  isHelper.equalTo('helper', request.user);

  var isAuthor = new Parse.Query('Request');
  isAuthor.equalTo('author', request.user);

  // Combined query
  var query = Parse.Query.or(isHelper, isAuthor);
  query.equalTo('dealing', true);
  query.equalTo('closed', false);
  query.equalTo('expired', false);
  query.include(['author', 'helper', 'item']);
  query.descending('updatedAt');
  query.limit(limit);
  query.skip((page - 1) * limit);

  query.find().then(response.success, response.error);
});

/**
 * Respond a request
 *
 * @param {string} requestId
 * @param {bool} [hasItem=true]
 *
 * @response void
 */
Parse.Cloud.define('respond', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var helper    = request.user;
  var requestId = request.params.requestId;
  var hasItem   = request.params.hasItem || true;

  // Get request
  var query = new Parse.Query('Request');
  query.notEqualTo('author', helper);
  query.equalTo('dealing', false);
  query.equalTo('closed', false);
  query.equalTo('expired', false);

  query.get(requestId).then(function(req) {
    if (hasItem) {
      // Add item to user's inventory
      helper.addUnique('has', req.get('item'));
      helper.save();

      // Change request's state
      req.set('dealing', true);
      req.set('helper', helper);
      return req.save();
    } else {
      // Remove item from user's inventory and add to user's hasNot list
      helper.remove('has', req.get('item'));
      helper.addUnique('hasNot', req.get('item'));

      return helper.save();
    }
  }).then(response.success, response.error);
});

/**
 * Close a request
 *
 * @param {string} requestId
 * @param {bool} [successful=true]
 *
 * @response {Parse.Object} request
 */
Parse.Cloud.define('close', function(request, response) {
  // Params
  var requestId   = request.params.requestId;
  var successful  = request.params.successful || true;

  // Query request
  var query = new Parse.Query('Request');
  query.include(['helper', 'author']);
  query.equalTo('closed', false);

  query.get(requestId).then(function(req) {
    var helper = req.get('helper');

    if (req.getACL().getWriteAccess(request.user) && successful) {
      // Increment helper's requests limit
      helper.increment('requestsLimit');
      helper.save(null, {useMasterKey: true});

      // Close request
      req.set('dealing', false);
      req.set('closed', true);
      return req.save();
    } else {
      // Unassign helper and close request
      req.set('helper', undefined);
      req.set('dealing', false);
      req.set('closed', true);
      return req.save();
    }
  }).then(response.success, response.error);
});

/**
 * Cancel a deal
 *
 * @param {string} requestId
 *
 * @response void
 */
Parse.Cloud.define('cancel', function(request, response) {
  // Params
  var requestId = request.params.requestId;

  // Query request
  var query = new Parse.Query('Request');
  query.include('author');

  query.get(requestId).then(function(req) {
    // Unassign helper and close request
    req.set('helper', undefined);
    req.set('dealing', false);

    return req.save(null, {useMasterKey: true});
  }).then(response.success, response.error);
});

/**
 * Send message
 *
 * @param {string} requestId
 * @param {string} content
 *
 * @response {Parse.Object} message
 */
Parse.Cloud.define('sendMessage', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var requestId = request.params.requestId;
  var content   = request.params.content;
  var from      = request.user;

  // Query
  var isHelper = new Parse.Query('Request');
  isHelper.equalTo('helper', from);

  var isAuthor = new Parse.Query('Request');
  isAuthor.equalTo('author', from);

  // Request
  var query = Parse.Query.or(isHelper, isAuthor);
  query.include(['author', 'helper']);

  query.get(requestId).then(function(req) {
    if (req.get('helper')) {
      // Message
      var message = new Parse.Object('Message');
      var acl = new Parse.ACL();

      acl.setPublicReadAccess(false);
      acl.setPublicWriteAccess(false);
      acl.setWriteAccess(from, true);
      acl.setReadAccess(req.get('author'), true);
      acl.setReadAccess(req.get('helper'), true);

      message.setACL(acl);
      message.set('request', req);
      message.set('from', from);
      message.set('content', content);

      return message.save();
    } else {
      return Parse.Promise.error('Missing helper');
    }
  }).then(response.success, response.error);
});

/**
 * Get messages
 *
 * @param {string} requestId
 * @param {int} [limit=30]
 * @param {int} [page=1]
 *
 * @response {Parse.Object[]} List of messages
 */
Parse.Cloud.define('getMessages', function(request, response) {
  // Params
  var requestId = request.params.requestId;
  var limit     = request.params.limit || 30;
  var page      = request.params.page || 1;

  // Query
  var query = new Parse.Query('Message');
  query.include('request');
  query.ascending('createdAt');
  query.limit(limit);
  query.skip((page - 1) * limit);

  query.find().then(response.success, response.success);
});

/**
 * Get items based on a string
 *
 * @param {string} string String for search item
 * @param {int} [limit=10]
 *
 * @response {Parse.Object[]} List of items
 */
Parse.Cloud.define('getItems', function(request, response) {
  // Params
  var string = request.params.string;
  var limit  = request.params.limit || 10;

  // Query
  var query = new Parse.Query('Item');
  query.contains('nameLowercase', string.toLowerCase());
  query.limit(limit);

  query.find().then(response.success, response.error);
});

/**
 * Cloud job to clear expired requests
 *
 * @param {int} [hours=24] Hours to expire
 */
Parse.Cloud.job('clearRequests', function(request, status) {
  Parse.Cloud.useMasterKey();

  // Params
  var hours = request.params.hours || 24;

  // Info
  var hour  = 1000 * 60 * 60;
  var now   = Date.now();

  // Query
  var query = new Parse.Query('Request');
  query.ascending('createdAt');
  query.equalTo('expired', false);

  query.find().then(function(requests) {
    var requestsToExpire = [];

    // Loop through results verifying if it expired
    for (var i = 0; i < requests.length; i++) {
      var req = requests[i];
      var reqTime = req.createdAt.getTime();

      // The difference between current time and request's created time must be
      // lower than the number of hours to expire, otherwise it expires
      if (now - reqTime >= hour * hours) {
        req.set('expired', true);
        requestsToExpire.push(req);
      }
    }

    if (requestsToExpire.length) {
      return Parse.Object.saveAll(requestsToExpire);
    } else {
      return Parse.Promise.as('Nothing to expire');
    }
  }).then(status.success, status.error);
});
