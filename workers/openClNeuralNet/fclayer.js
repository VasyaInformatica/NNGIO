var cl = require("./../../../node-opencl-master/lib/opencl");
var { ctx, device, importCL } = require("./../openCLHelper");
var { FLOATSIZE, INTSIZE } = require("./../openCLHelper/variables");
var { Memory } = require("./memory");
var { getKernel } = require("./../openCLHelper/kernels");

class Weight {
  constructor() {
    this.buffer = null;
    this.bufferTemp = null;
    this.width = null;
    this.height = null;
    this.type = "default";
  }

  clear() {}
  resize() {}
  save() {}
  load() {}
}

module.exports.FCLayer = class FCLayer extends Memory {
  constructor(...params) {
    super(...params);
    this.connect = {};
    this.errorMap = cl.createBuffer(ctx, cl.MEM_READ_WRITE, FLOATSIZE * this.width * this.height, null);
    this.clearError();
    this.fclayerCompile();
  }

  fclayerCompile() {
    //generate code

    //activate
    var code = `__kernel void kernel ${"activate" + this.id}( __global int16* bufferA){
    bufferA[get_global_id(0)]=bufferA[get_global_id(0)]&0x7FFFFFFF;
    };`;
    var prog = cl.createProgramWithSource(ctx, code);
    try {
      var state = cl.buildProgram(prog);
      if (state) {
        new Error(state);
      }
    } catch (err) {
      console.error("error", cl.getProgramBuildInfo(prog, device, cl.PROGRAM_BUILD_LOG));
    }
    this.activateKernel = cl.createKernel(prog, "activate" + this.id);
    cl.setKernelArg(this.activateKernel, 0, "int16*", this.activateMap);
  }

  clearError() {
    cl.enqueueFillBuffer(this.cq, this.errorMap, FLOATSIZE, 0, 0, new Uint32Array([FLOATSIZE * this.width * this.height], 0, 1));
  }

  RELUactivate(cq, kern, NVALUES) {
    var err;
    err = cl.enqueueNDRangeKernel(this.cq, this.activateKernel, 1, [0], [this.width * this.height / 16], null);
    if (err) {
      console.log(err);
    }
    cl.finish(this.cq);
  }

  softMaxActivate() {
    /*
    //long int start_s=GetTickCount();//test

    kernelActivate.setArg(0, this.activateMap);
    queueMain.enqueueNDRangeKernel(kernelActivate, cl.NullRange, cl.NDRange(this.width * this.height / 16), cl.NullRange);
    queueMain.finish();
*/
    //printf("activate %i \n",GetTickCount()-start_s);
  }

  getErrorFromCompare(layer) {
    if (layer.width != this.width || layer.height != this.height) {
      throw Error("layer.width != this.width || layer.height != this.height");
    } else {
      var KernelGetError = getKernel("getError");
      cl.setKernelArg(KernelGetError, 0, "float16*", this.activateMap);

      cl.setKernelArg(KernelGetError, 1, "float16*", layer.activateMap);

      cl.setKernelArg(KernelGetError, 2, "float16*", this.errorMap);
      cl.enqueueNDRangeKernel(this.cq, KernelGetError, 1, [0], [this.width * this.height / 16], null);
      cl.finish(this.cq);
    }
  }
  mutateWeight(layer) {
    var KernelMutateWeight = getKernel("mutateWeight");
    this.tempy = Math.floor((Math.random() - 0.5) * 100);
    this.tempx = Math.floor(Math.random() * 1000000);

    var buffer_layerInfo = cl.createBuffer(ctx, cl.MEM_READ_WRITE, INTSIZE * 3, null);

    var param = new Buffer(INTSIZE * 3);
    param.writeInt32LE(layer.width * layer.height, 0);
    param.writeInt32LE(this.tempx, INTSIZE * 1);
    param.writeInt32LE(this.tempy, INTSIZE * 2);

    var t1 = cl.setKernelArg(KernelMutateWeight, 0, "float*", this.connect[layer.id].bufferTemp);
    var t2 = cl.setKernelArg(KernelMutateWeight, 1, "float*", this.connect[layer.id].buffer);
    var t3 = cl.setKernelArg(KernelMutateWeight, 2, "int*", buffer_layerInfo);

    var event = cl.enqueueWriteBuffer(this.cq, buffer_layerInfo, true, 0, INTSIZE * 3, param, null, true);
    var kernelEvent = cl.enqueueNDRangeKernel(this.cq, KernelMutateWeight, new Uint32Array([1]), [0], [this.width * this.height], null, [event], true);
    cl.waitForEvents([kernelEvent]);
    cl.finish(this.cq);
  }

  checkMutateWeight(layer, layerChange) {
    var KernelCheckMutateWeight = getKernel("checkMutateWeight");
    var param = new Buffer(INTSIZE * 3);
    param.writeInt32LE(layerChange.width * layerChange.height, 0);
    param.writeInt32LE(this.tempx, INTSIZE * 1);
    param.writeInt32LE(this.tempy, INTSIZE * 2);
    var buffer_layerInfo = cl.createBuffer(ctx, cl.MEM_READ_WRITE, INTSIZE * 3, null);

    cl.setKernelArg(KernelCheckMutateWeight, 0, "float*", layer.activateMap);
    cl.setKernelArg(KernelCheckMutateWeight, 1, "float*", this.activateMap);
    cl.setKernelArg(KernelCheckMutateWeight, 2, "float*", this.errorMap);
    cl.setKernelArg(KernelCheckMutateWeight, 3, "float*", this.connect[layer.id].bufferTemp);
    cl.setKernelArg(KernelCheckMutateWeight, 4, "float*", this.connect[layer.id].buffer);
    cl.setKernelArg(KernelCheckMutateWeight, 5, "int*", buffer_layerInfo);
    var event = cl.enqueueWriteBuffer(this.cq, buffer_layerInfo, true, 0, INTSIZE * 3, param, null, true);
    var kernelEvent = cl.enqueueNDRangeKernel(this.cq, KernelCheckMutateWeight, 1, [0], [this.width * this.height], null, [event], true);

    cl.waitForEvents([kernelEvent]);
    cl.finish(this.cq);
  }
  bind(layer) {
    if (!this.connect.hasOwnProperty(layer.id)) {
      var weight = new Weight();
      weight.width = this.width * layer.width;
      weight.height = this.height * layer.height;
      weight.type = "fullConnectedWeight";
      weight.buffer = cl.createBuffer(ctx, cl.MEM_READ_WRITE, FLOATSIZE * weight.width * weight.height, null);
      weight.bufferTemp = cl.createBuffer(ctx, cl.MEM_READ_WRITE, FLOATSIZE * weight.width * weight.height, null);
      cl.enqueueFillBuffer(this.cq, weight.buffer, FLOATSIZE, 0, weight.width * weight.height, null, null);

      //multiple compile
      var codeMultiple = `__kernel void kernel ${"multiple" + this.id}(  __global float* bufferIn,  __global float* bufferOut , __global float* bufferW){
      
  float out=0.0;
  for(size_t x=0;x!=(${layer.width * layer.height}); x++){
          
          out+=bufferIn[x]*bufferW[get_global_id(0)*${layer.width * layer.height}+x];
  
  }
  bufferOut[get_global_id(0)]=out;
  
  };`;
      var progMultiple = cl.createProgramWithSource(ctx, codeMultiple);
      try {
        var state = cl.buildProgram(progMultiple);
        if (state) {
          new Error(state);
        }
      } catch (err) {
        console.error("error", cl.getProgramBuildInfo(progMultiple, device, cl.PROGRAM_BUILD_LOG));
      }
      this["multilpeKernel" + layer.id] = cl.createKernel(progMultiple, "multiple" + this.id);

      var buffer = cl.createBuffer(ctx, cl.MEM_READ_WRITE, INTSIZE * 1, null);
      var t1 = cl.setKernelArg(this["multilpeKernel" + layer.id], 0, "float*", layer.activateMap);
      var t2 = cl.setKernelArg(this["multilpeKernel" + layer.id], 1, "float*", this.activateMap);
      var t3 = cl.setKernelArg(this["multilpeKernel" + layer.id], 2, "float*", weight.buffer);

      //getErrorFromCompare
      var code = `__kernel void kernel ${"getError" + this.id}( __global float16* bufferIn, __global float16* bufferOut, __global float16* bufferError){

  bufferError[get_global_id(0)]=fabs(bufferIn[get_global_id(0)]-bufferOut[get_global_id(0)])*fabs(bufferIn[get_global_id(0)]-bufferOut[get_global_id(0)]);
  
  };`;
      var prog = cl.createProgramWithSource(ctx, code);
      try {
        var state = cl.buildProgram(prog);
        if (state) {
          new Error(state);
        }
      } catch (err) {
        console.error("error", cl.getProgramBuildInfo(prog, device, cl.PROGRAM_BUILD_LOG));
      }
      this[Kernel] = cl.createKernel(prog, "getError" + this.id);
      cl.setKernelArg(KernelGetError, 0, "float16*", this.activateMap);

      cl.setKernelArg(KernelGetError, 1, "float16*", layer.activateMap);

      cl.setKernelArg(KernelGetError, 2, "float16*", this.errorMap);

      this.connect[layer.id] = weight;
    }
  }

  setRandomWeight(layer) {
    var layerWeight = this.connect[layer.id];
    var temp = new Buffer(layerWeight.height * layerWeight.width * FLOATSIZE);
    for (var i = 0; i !== layerWeight.height * layerWeight.width; i++) {
      temp.writeFloatLE(Math.random() - 0.5, i * FLOATSIZE);
    }

    cl.enqueueWriteBuffer(this.cq, layerWeight.buffer, true, 0, FLOATSIZE * layerWeight.height * layerWeight.width, temp);
    cl.finish(this.cq);
  }
  multiple(layer) {
    var err = cl.enqueueNDRangeKernel(this.cq, this["multilpeKernel" + layer.id], 1, [0], [this.width * this.height], null);
    if (err) {
      console.log(err);
    }
    cl.finish(this.cq);
  }
};

function get_event_exec_time(event) {
  // times are 64-bit values in naniseconds. They are returned as [hi,lo] a 2-integer array
  // here we use the lo parts since this example is unlikely to go beyond 2^31 nanseconds per event.
  var start_time = cl.getEventProfilingInfo(event, cl.PROFILING_COMMAND_START);
  var end_time = cl.getEventProfilingInfo(event, cl.PROFILING_COMMAND_END);

  return (end_time[1] - start_time[1]) * 1e-6; // report in millisecond (from nanoseconds)
}
