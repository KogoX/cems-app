const router = require("express").Router();

let payments = [
  { id: "ORD-2024-892", buyer: "Global Green Exporters", quantity: "1,200 kg", amount: "KES 36,000.00", status: "Verified" },
  { id: "ORD-2024-885", buyer: "EuroHarvest GmbH", quantity: "850 kg", amount: "KES 25,500.00", status: "Pending" },
  { id: "ORD-2024-870", buyer: "AvoDirect UK Ltd.", quantity: "2,400 kg", amount: "KES 72,000.00", status: "Verified" }
];

router.get("/", (req, res) => {
  res.json(payments);
});

router.post("/", (req, res) => {
  const newPayment = { id: `ORD-${Date.now()}`, ...req.body };
  payments.unshift(newPayment);
  res.json(newPayment);
});

module.exports = router;
