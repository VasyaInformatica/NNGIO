var cl = require("./../../node-opencl-master/lib/opencl");

var ctx;

if (cl.createContextFromType !== undefined) {
  ctx = cl.createContextFromType([cl.CONTEXT_PLATFORM, cl.getPlatformIDs()[0]], cl.DEVICE_TYPE_ALL, null, null);
} else {
  var platform = cl.getPlatformIDs()[0];
  ctx = cl.createContext([cl.CONTEXT_PLATFORM, platform], [cl.getDeviceIDs(platform, cl.DEVICE_TYPE_ALL)[0]]);
}
module.exports.device = cl.getContextInfo(ctx, cl.CONTEXT_DEVICES)[0];

module.exports.ctx = ctx;
