with open("screens/banks.js", "r") as f:
    text = f.read()

text = text.replace(r"\${", "${")
text = text.replace(r"\`", "`")

with open("screens/banks.js", "w") as f:
    f.write(text)
