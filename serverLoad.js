// serverLoad.js
const os = require("os");

const getServerLoad = (startTime) => {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const heapStatistics = process.memoryUsage().heapUsed;
  
    const endTime = process.hrtime.bigint();
    const elapsedTimeMs = Number((endTime - startTime) / BigInt(1000000)); 
    const elapsedTimeSeconds = elapsedTimeMs / 1000;
    let totalTimeMsg;
    if (elapsedTimeSeconds >= 60) {
      const minutes = Math.floor(elapsedTimeSeconds / 60);
      const remainingSeconds = Math.round(elapsedTimeSeconds % 60);
      totalTimeMsg = `${minutes} minute${
        minutes > 1 ? "s" : ""
      } ${remainingSeconds} seconds`;
    } else if (elapsedTimeMs >= 1000) {
      totalTimeMsg = `${elapsedTimeSeconds.toFixed(2)} seconds`;
    } else {
      totalTimeMsg = `${elapsedTimeMs} milliseconds`;
    }
  
    const memoryUsageMB = (memoryUsage.rss / (1024 * 1024)).toFixed(2);
  
    const totalCpuUsageMicros = cpuUsage.user + cpuUsage.system;
    const totalCpuUsageSeconds = totalCpuUsageMicros / 1e6;
    const totalCpuUsagePercentage = (
      (totalCpuUsageSeconds / elapsedTimeSeconds) *
      100
    ).toFixed(2);
  
    const totalHeapUsageBytes = os.totalmem() - os.freemem();
    const heapUsagePercentage = (
      (heapStatistics / totalHeapUsageBytes) *
      100
    ).toFixed(2);
  
    console.log("================== USAGE ==================");  
    console.log("Total time for scraping = " + totalTimeMsg);
    console.log(`Memory usage = ${memoryUsageMB} MB`);
    console.log(`CPU usage =  ${totalCpuUsagePercentage}%`);
    console.log(`Heap usage = ${heapUsagePercentage}%`);  
    console.log("================== END SCRAPPING ==================");
};

module.exports = { getServerLoad };