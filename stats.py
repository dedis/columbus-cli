import matplotlib.pyplot as plt
import sys
import glob
import csv
import itertools

""" Takes a path in argument that contains files in the form
"result-nnn-v.csv", where nnn is the total number of block and v the version in
the case of multiple run.
"""

if len(sys.argv) != 2:
    print("please give in argument the path to the folder that contains the stat files")

folder_path = sys.argv[1]
txtfiles = []
for file in glob.glob(folder_path + "/*.csv"):
    splits = file.split("-")
    if len(splits) not in [2, 3]:
        print("wrong filename: {file}")
        exit(1)
    version = 0

    # remove the ".csv"
    splits[-1] = splits[-1][:-4]
    if len(splits) == 3:
        version = splits[2]
    txtfiles.append({"filename": file, "num_blocks": splits[1], "version": version})

print(txtfiles)

fig, ax = plt.subplots()
marker = itertools.cycle(('v', '+', '.', 'o', '*', '1', '2', '3', '4', 'x', 'D'))

for experiment in txtfiles:
    #if experiment["version"] != 0:
    #    continue
    if experiment["num_blocks"] != "4000":
        continue
    with open(experiment["filename"]) as csv_file:
        csv_reader = csv.reader(csv_file, delimiter=",")
        first = True
        xs = []
        ys = []
        for row in csv_reader:
            if first:
                first = False
                continue
            #xs.append(int(row[0])/int(experiment["num_blocks"])*100)
            xs.append(int(row[1]))
            ys.append(float(row[2]))
        ax.plot(xs, ys, marker=next(marker), linestyle="-", label=experiment["version"])

ax.set(xlabel="num pages", ylabel="time to fetch 4000 blocks [ms]", title="Time it takes to fetch 4000 blocks with different number of pages across multiple runs")
plt.xscale('log')
xticks = [i for i in range(1, 4001) if 4000 % i == 0]
plt.xticks(xticks, xticks)
ax.grid(axis="x", alpha=.3)
ax.legend()
plt.show()
fig.savefig("result.pdf")
