var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);

const port = process.env.PORT || 3000;

app.use(function (req, res, next) {
  console.log('middleware');
  req.testing = 'testing';
  return next();
});

app.get('/', function(req, res, next){
  console.log('get route', req.testing);
  res.send('Matchmaking server, websocket access only');
  res.end();
});

app.ws('/', function(ws, req) {
  ws.on('message', function(msg) {
    console.log(msg);
  });
  console.log('socket', req.testing);
});

app.listen(port, () => {
  console.log(`Matchmaker app listening on port ${port}`);
});