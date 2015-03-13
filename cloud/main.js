var _ = require('underscore');

/**
 * Get requests
 *
 * @param int limit
 * @param int page
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