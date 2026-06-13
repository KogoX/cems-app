const router = require("express").Router();

let yields = [
  { id: 1, cropSeason: "Main Season 2024", quantity: 2500, grade: "A", date: "2024-05-10" },
  { id: 2, cropSeason: "Short Rains 2023", quantity: 1800, grade: "B", date: "2023-11-20" }
];

router.get("/", (req, res) => {
  res.json(yields);
});

router.post("/", (req, res) => {
  const newYield = { id: Date.now(), ...req.body };
  yields.unshift(newYield);
  res.json(newYield);
});

module.exports = router;
