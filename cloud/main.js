var _ = require('underscore');

/**
 * Get requests
 *
 * @param int optional limit
 * @param int optional page
 *
 * @todo order requests by user's genre, course and inventory.
 *
 * @response array list of request objects
 */
Parse.Cloud.define('requests', function(request, response) {
  // Params
  var genre = request.user.get('genre');
  var course = request.user.get('course');
  var location = request.user.get('location');
  var inventory = request.user.get('inventory');
  var limit = request.params.limit || 30;
  var page = request.params.page || 1;

  // Query
  var query = new Parse.Query('Request');
  query.equalTo('open', false);
  query.include(['author', 'item']);
  query.limit(limit);
  query.skip((page - 1) * limit);

  query.near('author.location').then(response.success, response.error);
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
  // Params
  var helper = request.user;
  var hasItem = request.params.hasItem || true;

  // Get request
  var query = new Parse.Query('Request');

  query.get(request.params.requestId).then(function(req) {
    // If user respond that he has item and request is open
    if (hasItem && !req.get('open')) {
      // Add item to user's inventory
      helper.addUnique('inventory', req.get('item'));
      helper.save();

      // Change request's state
      req.set('open', true);
      req.set('helper', helper);
      return req.save();
    }
    // If user respond that he hasn't
    else if (!hasItem) {
      // Remove item from user's inventory and add to user's hasNot list
      helper.remove('inventory', req.get('item'));
      helper.addUnique('hasNot', req.get('item'));

      return helper.save();
    }
    // If request isn't open
    else {
      return Parse.Promise.error();
    }
  }).then(function() {
    response.success();
  }, function() {
    response.error();
  });
});