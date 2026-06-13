const router = require("express").Router();

let farmers = [
  { id: "F-102", name: "Peter Kamau", location: "Kiambu", status: "Active", yield: "14.2k kg" },
  { id: "F-105", name: "Mary Wanjiku", location: "Muranga", status: "Pending", yield: "8.5k kg" },
  { id: "F-108", name: "John Omondi", location: "Kisii", status: "Active", yield: "22.1k kg" }
];

router.get("/", (req, res) => {
  res.json(farmers);
});

router.post("/", (req, res) => {
  const newFarmer = { id: `F-${Date.now().toString().slice(-3)}`, ...req.body };
  farmers.unshift(newFarmer);
  res.json(newFarmer);
});

module.exports = router;
