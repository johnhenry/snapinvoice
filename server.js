var ejs = require("ejs");
var fs = require("fs");
var https = require("https");
var express = require("express");
var path = require('path');
var favicon = require('static-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var credentials = require("./credentials");
var invoices;
var io;
var iosocket;
var app = require('express')();
var server = require('http').Server(app);
var io = require('socket.io')(server);


var ObjectID = require('mongodb').ObjectID;
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(favicon());
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

var getView = function(viewName){
    return fs.readFileSync("./views/" + viewName + ".html.ejs", "utf8");
}

//Create Invoice
app.get("/",function(req, res, next) {
    res.render("content.html.ejs", {
        content : ejs.render(getView("create"))
    });
});

//Create Invoice
app.post("/api/1/",function(req, res, next) {
    var amount = Number(req.body.amount);
    var expiration = Number(req.body.expiration);
    var payTo = req.body.payto;

    var errors = [];
    if(amount <= 0){
        errors.push("Amount Must Be Positive");
    }
    if(false){//TODO: Check to make sure address is valid
        errors.push("Bitcoin address is invalid");
    }
    if(false){//TODO: Ensure expiration date is in the future
        errors.push("Expiration date must be in the future.");
    }
    if(errors.length > 0){
        res.status(404);
        res.json({errors:errors});
        return;
    }
    var invoice = {
        status : "pending",
        payTo : payTo,
        amount: amount,
        due: amount,
        expiration : expiration + Math.floor(Date.now()/1000),
        addresses : []
    }

    //Create Invoice In Database
    invoices.insert(invoice, function(err, inv){
        if(err){
            //Describe Error
            res.status(404);
            res.json({errors:[err]});
            return;
        }
        var id = inv[0]._id;
        invoices.findOne({_id:ObjectID(id)},function(error,invoice){
            if(error){
                //Describe Error
                res.status(404);
                res.json({errors:[error]});
                return;
            }
    
            createAddress(req, invoice, function(error, invoice){
                if(error){
                    res.status(404);
                    res.json(error);
                }
                res.json(invoice);
                }

            )
            })
        }
    )
});

var createAddress = function(req, invoice, callback){
    var requestUrlPlus = "https://blockchain.info/api/receive?method=create&address=" + invoice.payTo + "&callback=" + encodeURIComponent(req.protocol + '://' + req.get('host') + "/update/" + invoice._id);
    var requestUrlMinus = "https://blockchain.info/api/receive?method=create&address=" + invoice.payTo + "&callback=" + req.protocol + '://' + req.get('host') + "/update/" + invoice._id;
    var requestUrl = "https://blockchain.info/api/receive?method=create&address=" + invoice.payTo;
    console.log(requestUrlMinus);
    console.log(requestUrlPlus);
    var body = '';
    requestUrl = requestUrlPlus;
    https.get(requestUrl, function(response) {
        response.on('data', function(chunk) {
            body += chunk;
        });
        response.on('end', function() {
           // console.log(invoice);
            try{
                var addressResponse = JSON.parse(body);
                invoices.findOne({_id:ObjectID(invoice._id)},function(err,inv){
                    if(err){
                            callback({errors:[err]});
                            return;
                    }
                    console.log(inv);
                    invoices.update({_id:inv._id}, { 
                        $set:{
                            status:"open"
                            },
                        $push :{
                            addresses : addressResponse.input_address
                        }
                        },
                        function(e, result) {
                            if(e){
                                callback({errors:[e]});
                                return;
                            }
                            invoices.findOne({_id:invoice._id},function(e, i){
                                if(e){
                                    callback({errors:[e]});
                                    return;
                                }else{
                                    callback(null, i);
                                    return;
                                }
                            });
                    });
                
                })

            }catch(error){
              callback({errors:[body,error]});
            }

        });
    }).on('error', function(e) {
          callback({errors:[body]});
          return;
    });

}


//Recieve Updates About Invoices From Blockchain.info
app.get("/update/:id", function(req, res, next) {
    //Note:Sending ok back to the blockchain.info api prevents further updates.
    console.log("Update Attemted.");
    var id = req.body.id;
    var value = req.query.value;
    invoices.findOne({_id:ObjectID(id)},function(error, invoice){
        if(error || invoice === null){
            res.status(404);
            res.json({errors:[error]});
            return;
        }
        if(invoice.status === "open"){
            if(Date.now() >= Number(invoice.expiration)){//Invoice has expired
                invoice.status = "expired";
                //TODO:Remove Listening Socket
                invoices.update({_id:ObjectID(id)},invoice,function(error,result){
                    if(error){
                        res.status(404);
                        res.json({errors:[error]});
                        return;
                    }
                    res.send("ok");

                });
            }else{
                invoice.due = Number(invoice.due) - Number(invoice.amount);
                if(invoice.due <= 0){//Invoice has been fully paid
                    invoice.status = "paid";
                    invoices.update({_id:invoice._id},invoice,function(error,result){
                        if(error){
                            res.status(404);
                            res.json({errors:[error]});
                            return;
                        }
                        res.send("ok");

                    });
                    //TODO:Remove Listening Socket
                }else{//Invoice has been partially paid
                    createAddress(req, invoice, function(error, invoice){
                        if(error){
                            res.status(404);
                            res.json({errors:[error]});

                        }
                        res.send("ok");
                        }
                    )
                }
            }
            iosocket.emit(id,{});   
            return;
        };
    });
});

//Get Invoice
app.get("/api/1/:id",function(req, res, next) {
    var id = req.params.id;
    
    invoices.findOne({_id:ObjectID(id)},function(error, invoice){
        if(Math.floor(Date.now()/1000) > invoice.expiration){
            invoice.status = "expired";
        }
        if(error){
            res.status(404);
            res.json({errors:[error]});
            return;
        }
        res.json(invoice);
    });
    
});


//Show Invoice
app.get("/:id",function(req, res, next) {
    var id = req.params.id;
    try{
        invoices.findOne({_id:ObjectID(id)},function(error, invoice){
            console.log(id);
            if(error || (invoice && invoice.status === "pending") || !invoice){
                res.status(404);
                res.render("content.html.ejs", {
                    content : ejs.render(getView("invoice-missing"), {_id:id})
                });
                return

            }
            if(Math.floor(Date.now()/1000) > invoice.expiration){
                invoice.status = "expired";
            }
            res.render("content.html.ejs", {
                content : ejs.render(getView("invoice-" + invoice.status),invoice)
            });
        });
    
    }catch(e){
        res.status(404);
        res.render("content.html.ejs", {
            content : ejs.render(getView("invoice-missing"), {_id:id})
        });
    
    }
});

var mongoURL = "mongodb://" + credentials.mongoUser + ":" + credentials.mongoPassword + "@" + credentials.mongoURL;
var MongoClient = require('mongodb').MongoClient;
MongoClient.connect(mongoURL, function(error, database) {
    if(error){
        throw(error);
        return;
    }
    console.log("Database Connected");
    invoices = database.collection('invoices');
    var port = process.env.PORT || process.env.OPENSHIFT_NODEJS_PORT || 80;
    server.listen(port, function() {
        console.log('Listening on port %d', port);
    });
    io.on('connection', function (socket) {
      iosocket = socket;
    });
});