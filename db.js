var mongoose = require("mongoose");
var io = require("./socket");
var { stringifyError } = require("./helper");
mongoose.connect("mongodb://localhost:27017/nngio");
var db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));

var ErrorLogSchema = new mongoose.Schema({
  text: String,
  createdAt: Number
});

var ErrorLog = mongoose.model("ErrorLog", ErrorLogSchema);

global.errLog = function errLog(err) {
  console.error(err);
  var plainObject = [];
  var temp = stringifyError(err);

  io.in("admin").emit("admin", {
    type: "error",
    body: { text: temp, createdAt: Date.now() }
  });

  ErrorLog({
    text: JSON.stringify({ body: temp }),
    createdAt: Date.now()
  }).save(err => {
    if (err) console.error(err);
  });
};

var DataSchema = new mongoose.Schema({
  updatedAt: Date,
  type: String,
  test: { type: Boolean, default: false },
  data: mongoose.SchemaTypes.Mixed
});
DataSchema.pre("save", function(next) {
  this.updatedAt = Date.now();

  next();
});
const Data = mongoose.model("Data", DataSchema);

var DataSetSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, index: true },
  type: String,
  updatedAt: Date,
  usedAt: Date,
  compressed: String,
  compressData: Buffer,
  array: [{ type: mongoose.Schema.Types.ObjectId, ref: "Data" }]
});
DataSetSchema.pre("save", function(next) {
  this.updatedAt = Date.now();

  next();
});

const DataSet = mongoose.model("DataSet", DataSetSchema);

var LayerSchema = new mongoose.Schema({
  type: String,
  width: Number,
  height: Number,
  size: Number,
  bind: [
    {
      mapIndex: Number,
      layerIndex: Number
    }
  ]
});

const Net = mongoose.model("Net", {
  date: Date,
  type: String,
  error: Number,
  options: mongoose.SchemaTypes.Mixed,
  layers: [LayerSchema],
  maps: [Buffer]
});

const NeuralNet = mongoose.model("NeuralNet", {
  name: { type: String, required: true, unique: true },
  last: { type: mongoose.Schema.Types.ObjectId, ref: "Net" },
  versions: [{ type: mongoose.Schema.Types.ObjectId, ref: "Net" }],
  type: String
});

module.exports = { Net, NeuralNet, Data, DataSet };
