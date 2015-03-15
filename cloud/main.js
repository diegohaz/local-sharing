/**
 * Validate user, call Facebook API for more information
 */
 Parse.Cloud.beforeSave(Parse.User, function(request, response) {
  var user = request.object;
  var fb = user.get('authData').facebook;

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
});

/**
 * Make a request
 *
 * @param string item
 *
 * @response Parse.Object request
 */
Parse.Cloud.define('request', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var user = request.user;
  var itemName = request.params.item;

  // Query item
  var item = new Parse.Object('Item');
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

    req.set('author', user);
    req.set('item', item);
    req.set('open', false);
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
 * @param int optional limit
 * @param int optional page
 *
 * @todo Order requests by user's gender, course and inventory.
 *
 * @response array List of request objects
 */
Parse.Cloud.define('getRequests', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var location = request.user.get('location');
  var has = request.user.get('has');
  var hasNot = request.user.get('hasNot');
  var limit = request.params.limit || 30;
  var page = request.params.page || 1;

  // Query
  var query = new Parse.Query('Request');
  query.equalTo('open', false);
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
 * @param int optional limit
 * @param int optional page
 *
 * @todo Archive old requests
 *
 * @response array List of request objects
 */
Parse.Cloud.define('getUserRequests', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var limit = request.params.limit || 30;
  var page = request.params.page || 1;

  // query
  var query = new Parse.Query('Request');
  query.equalTo('author', request.user);
  query.include(['author', 'item']);
  query.ascending('createdAt');
  query.limit(limit);
  query.skip((page - 1) * limit);

  query.find().then(response.success, response.error);
});

/**
 * Get user's open requests
 *
 * @param int optional limit
 * @param int optional page
 *
 * @todo Archive old requests
 *
 * @response array List of request objects
 */
Parse.Cloud.define('getOpenRequests', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var limit = request.params.limit || 30;
  var page = request.params.page || 1;

  // Query
  var isHelper = new Parse.Query('Request');
  isHelper.equalTo('helper', request.user);

  var isAuthor = new Parse.Query('Request');
  isAuthor.equalTo('author', request.user);

  // Combined query
  var query = Parse.Query.or(isHelper, isAuthor);
  query.equalTo('open', true);
  query.include(['author', 'item']);
  query.ascending('updatedAt');
  query.limit(limit);
  query.skip((page - 1) * limit);

  query.find().then(response.success, response.error);
});

/**
 * Respond a request
 *
 * @param string requestId
 * @param bool optional hasItem
 *
 * @response void
 */
Parse.Cloud.define('respond', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var helper = request.user;
  var requestId = request.params.requestId;
  var hasItem = request.params.hasItem || true;

  // Get request
  var query = new Parse.Query('Request');

  query.get(requestId).then(function(req) {
    if (hasItem && !req.get('open')) {
      // Add item to user's inventory
      helper.addUnique('has', req.get('item'));
      helper.save();

      // Change request's state
      req.set('open', true);
      req.set('helper', helper);
      return req.save();
    } else if (!hasItem) {
      // Remove item from user's inventory and add to user's hasNot list
      helper.remove('has', req.get('item'));
      helper.addUnique('hasNot', req.get('item'));

      return helper.save();
    } else {
      return Parse.Promise.error();
    }
  }).then(response.success, response.error);
});

/**
 * Close a request
 *
 * @param string requestId
 * @param bool optional successful
 *
 * @response void
 */
Parse.Cloud.define('close', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var requestId = request.params.requestId;
  var successful = request.params.successful || true;

  // Query request
  var query = new Parse.Query('Request');
  query.include('helper');

  query.get(requestId).then(function(req) {
    var helper = req.get('helper');

    if (successful) {
      // Increment helper's requests limit
      helper.increment('requestsLimit');
      helper.save();

      // Close request
      req.set('open', false);
      return req.save();
    } else {
      // Unassign helper and keep request open
      req.set('helper', null);
      return req.save();
    }
  }).then(response.success, response.error);
});

/**
 * Send message
 *
 * @param string requestId
 * @param string content
 *
 * @response void
 */
Parse.Cloud.define('sendMessage', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var requestId = request.params.requestId;
  var content = request.params.content;
  var from = request.user;

  // Request
  var query = new Parse.Query('Request');

  query.get(requestId).then(function(req) {
    // Message
    var message = new Parse.Object('Message');

    message.set('request', req);
    message.set('from', from);
    message.set('content', content);

    return message.save();
  }).then(response.success, response.error);
});

/**
 * Get messages
 *
 * @param string requestId
 * @param int optional limit
 * @param int optional page
 *
 * @response array List of messages
 */
Parse.Cloud.define('getMessages', function(request, response) {
  Parse.Cloud.useMasterKey();

  // Params
  var requestId = request.params.requestId;
  var limit = request.params.limit || 30;
  var page = request.params.page || 1;

  // Query
  var query = new Parse.Query('Message');
  query.include('request');
  query.descending('createdAt');
  query.limit(limit);
  query.skip((page - 1) * limit);

  query.find().then(response.success, response.success);
});
