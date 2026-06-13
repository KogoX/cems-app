const router = require("express").Router();

let orders = [
  { id: "ORD-2024-892", buyer: "Global Green Exporters", quantity: "1,200 kg", status: "Shipped", date: "2024-06-12" },
  { id: "ORD-2024-885", buyer: "EuroHarvest GmbH", quantity: "850 kg", status: "Processing", date: "2024-06-10" },
  { id: "ORD-2024-870", buyer: "AvoDirect UK Ltd.", quantity: "2,400 kg", status: "Delivered", date: "2024-06-05" }
];

router.get("/", (req, res) => {
  res.json(orders);
});

router.post("/", (req, res) => {
  const newOrder = { id: `ORD-${Date.now()}`, ...req.body };
  orders.unshift(newOrder);
  res.json(newOrder);
});

module.exports = router;
