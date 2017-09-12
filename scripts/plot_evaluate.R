#!/usr/bin/env Rscript
require(ggplot2)
args = commandArgs(trailingOnly=TRUE)

if (length(args)<3) {
  stop("Arguments: data.csv name outputfile");
}

name <- args[2]
outputfile <- args[3]

data <- read.csv(args[1])
data$iterationCount <- factor(data$iterationCount)
data$totalSizeMb <- data$totalSize / (1024 * 1024)
data$leaksFixed <- factor(data$leaksFixed)
# Note: group=1 is needed to keep geom_path happy since there is only a single line
ggsave(outputfile, width = 5, height = 3, unit = "in", plot = ggplot(data=data, aes(x=iterationCount, y=totalSizeMb, group=leaksFixed, colour=leaksFixed)) + geom_line() + geom_point() + labs(y= "Heap Size (Megabytes)", x="Loop Iterations", title=paste(name, "Heap Size Over Loop Iterations", sep=" ")) + theme(plot.title = element_text(hjust = 0.5)))
