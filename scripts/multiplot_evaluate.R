#!/usr/bin/env Rscript
require(ggplot2)
args = commandArgs(trailingOnly=TRUE)

if (length(args)<3) {
  stop("Arguments: name outputfile file1 name1 file2 name2");
}

name <- args[1]
outputfile <- args[2]

count <- (length(args) - 2) / 2
allData <- NULL
for (i in 1:count) {
  csv <- args[(i * 2) + 1]
  print(csv)
  data <- read.csv(csv);
  type <- args[(i * 2) + 2]
  print(type)
  data$type <- type
  if (is.null(allData)) {
    allData <- data;
  } else {
    allData <- rbind(allData, data)
  }
}

allData$iterationCount <- factor(allData$iterationCount)
allData$totalSizeMb <- allData$totalSize / (1024 * 1024)
# Note: group=1 is needed to keep geom_path happy since there is only a single line
ggsave(outputfile, width = 5, height = 3, unit = "in", plot = ggplot(data=allData, aes(x=iterationCount, y=totalSizeMb, group=type, fill=type, colour=type)) + geom_line() + geom_point() + labs(y= "Heap Size (Megabytes)", x="Loop Iterations", title=paste(name, "Heap Size Over Loop Iterations", sep=" ")) + theme(plot.title = element_text(hjust = 0.5)))
